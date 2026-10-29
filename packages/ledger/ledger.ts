import { lstat, mkdir, open, readdir, readFile, realpath } from "node:fs/promises";
import { readFileSync, type Dirent } from "node:fs";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { decode, encode, readRecords } from "./records.ts";
import type { Hlc, LogEvent } from "./records.ts";

// On-disk format 1. Must stay byte-compatible with existing ledgers. The
// record format and what a segment's bytes mean are `records.ts`.

export { encode };
export type { Hlc, LogEvent };

/** What consumers see. Fold order already encodes `hlc`, so a reducer that overwrites gets last-writer-wins. */
export type Event<T = unknown> = Pick<LogEvent<T>, "type" | "v" | "at" | "payload">;

export type Writer = {
  /** Absolute when the ledger was opened with an absolute path. Created on the first `post`; side files go in subfolders of it. */
  directory: string;
  post(v: number, type: string, payload: unknown): Promise<Event>;
};

export type DeviceState = "ok" | "stalled" | "unavailable" | "clockSuspect";
export type DeviceStatus = { device: string; /** last seq folded */ folded: number; state: DeviceState; detail?: string };
export type LogStatus = { devices: DeviceStatus[]; /** absolute paths */ ignored: string[] };

export type Verdict = "ledger" | "newer" | "not-a-ledger" | "missing" | "unmarked";

/** How often a `Ledger` looks for change. See "Cadence" in `multi-writer.md`. */
export type Cadence = {
  /** From the end of one scan to the start of the next. */
  everyMs: number;
  /** A directory where nothing has changed for this long is quiet. */
  quietAfterMs: number;
  /** A quiet directory is read at most this often; any other is read on every scan. */
  quietEveryMs: number;
};

export const DEFAULT_CADENCE: Cadence = Object.freeze({ everyMs: 1000, quietAfterMs: 5 * 60_000, quietEveryMs: 30_000 });

/** A frozen copy of `k`, or a throw: a bad cadence spins or never reads, and nothing says so. */
function checkCadence(k: Cadence): Cadence {
  const ms = (n: unknown, min: number) => typeof n === "number" && Number.isFinite(n) && n >= min;
  if (typeof k !== "object" || k === null || !ms(k.everyMs, 1) || !ms(k.quietAfterMs, 0) || !ms(k.quietEveryMs, 0))
    throw new TypeError(`not a cadence: ${JSON.stringify(k)}; want { everyMs >= 1, quietAfterMs >= 0, quietEveryMs >= 0 } in ms`);
  return Object.freeze({ everyMs: k.everyMs, quietAfterMs: k.quietAfterMs, quietEveryMs: k.quietEveryMs });
}

/**
 * Whether a scan reads a directory: every time while it is active, now and then once it is quiet, never not at all.
 * Times are monotonic (`performance.now()`), so a wall clock set back cannot stop the reads.
 */
const due = (d: { changedAt: number; checkedAt: number }, now: number, k: Cadence) =>
  now - d.changedAt < k.quietAfterMs || now - d.checkedAt >= k.quietEveryMs;

const FORMAT = 1;
const SIGNATURE = "bULhVFqraHDHescwKKhK0g==";
const MARKER = `Signature: ${SIGNATURE}
# This folder is an append-only event ledger. Each subfolder belongs to one
# writing session. Do not edit, rename or delete anything here by hand.
read ${FORMAT}
write ${FORMAT}
`;
/**
 * Files at the top the format names besides `LEDGER`, with the bytes every build of this format writes.
 * Never reported, and a folder holding only these counts as empty. Changing a file's bytes is a format change:
 * two builds that create one ledger before they sync would leave a conflicted copy.
 */
const NAMED_EXTRAS: Readonly<Record<string, string>> = Object.freeze({
  "AGENTS.md": `# Event ledger

This folder is an event ledger that several writers share. How to read it
(the format, and why there is one folder per writer) is at
https://github.com/shovon/pbnotes/blob/main/packages/ledger/multi-writer.md.

Do not modify, rename or delete anything here by hand. The files are
append-only, and other writers share them through whatever syncs this folder.
`,
});
const SEGMENT = /^\d{16}\.log$/;
/** Dot-entries belong to the OS or a sync tool (`.DS_Store`, `.git`, `.stfolder`): never read, never reported. */
const hidden = (name: string) => name.startsWith(".");
/** A folder of the same name is not one: it is read as a writer, like any folder at the top. */
const named = (d: Dirent) => d.isFile() && Object.hasOwn(NAMED_EXTRAS, d.name);
const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;
const CHECKPOINT_EVERY = 1000;
/** Remote clocks further ahead than this still get folded, but don't drag ours forward. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const cmpHlc = (a: Hlc, b: Hlc) => a.l - b.l || a.c - b.c;
const cmp = (a: LogEvent, b: LogEvent) =>
  cmpHlc(a.hlc, b.hlc) || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0);

/** A fresh frozen copy per event: consumers can't see or depend on log internals, and one reducer can't mutate what others fold. */
const toEvent = ({ type, v, at, payload }: LogEvent): Event => Object.freeze({ type, v, at, payload });

const segmentName = (n: number) => `${String(n).padStart(16, "0")}.log`;
const pad2 = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function parseMarker(text: string): { read: number; write: number } | undefined {
  const lines = text.split("\n");
  if (lines.pop() !== "" || lines[0] !== `Signature: ${SIGNATURE}`) return;
  const rest = lines.slice(1).filter((l) => !l.startsWith("#"));
  const r = rest.length === 2 ? rest[0].match(/^read ([1-9]\d*)$/) : null;
  const w = r ? rest[1].match(/^write ([1-9]\d*)$/) : null;
  return r && w ? { read: Number(r[1]), write: Number(w[1]) } : undefined;
}

/** Classifies a folder without writing anything. */
export async function inspect(path: string): Promise<Verdict> {
  let text: string;
  try {
    text = await readFile(join(path, "LEDGER"), "utf8");
  } catch (err: any) {
    if (err.code === "EISDIR" || err.code === "ENOTDIR") return "not-a-ledger"; // LEDGER is a dir, or path is a file
    if (err.code !== "ENOENT") throw err;
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === "ENOENT") return "missing";
      throw err;
    }
    const visible = entries.filter((e) => !hidden(e.name) && !named(e));
    if (!visible.length) return "missing";
    for (const e of visible)
      if (e.isDirectory() && (await readdir(join(path, e.name))).some((n) => SEGMENT.test(n))) return "unmarked";
    return "not-a-ledger";
  }
  const m = parseMarker(text);
  if (!m) return "not-a-ledger";
  return m.read > FORMAT || m.write > FORMAT ? "newer" : "ledger";
}

async function fsyncDir(dir: string) {
  if (process.platform === "win32") return;
  const d = await open(dir, "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}

/** Writes `bytes` to `file` unless something is already there, which is left as it is. */
async function createOnce(file: string, bytes: string) {
  let fh;
  try {
    fh = await open(file, "wx");
  } catch (err: any) {
    if (err.code === "EEXIST") return; // someone beat us to it
    throw err;
  }
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function createMarker(path: string) {
  await mkdir(path, { recursive: true });
  await createOnce(join(path, "LEDGER"), MARKER); // a marker already there is judged by inspect()
}

/**
 * Best effort: the ledger is whole without them, so a folder that cannot take one (read-only, full) still opens.
 * Runs on every open, so ledgers made before #63 get them too; #106 limits it to creation.
 */
async function createNamedExtras(path: string) {
  await Promise.allSettled(Object.entries(NAMED_EXTRAS).map(([name, bytes]) => createOnce(join(path, name), bytes)));
}

const REFUSALS: Record<Exclude<Verdict, "ledger">, string> = {
  missing: "is missing or empty; only openOrCreate makes a ledger",
  newer: "was written by a newer ledger format; upgrade to open it",
  unmarked: "holds ledger segments but no LEDGER marker; refusing to touch it",
  "not-a-ledger": "is not a ledger (or its LEDGER marker is malformed); refusing to write into it",
};

export async function openOrCreate(path: string, cadence: Cadence = DEFAULT_CADENCE): Promise<Ledger> {
  checkCadence(cadence); // before anything is written
  let verdict = await inspect(path);
  if (verdict === "missing") {
    await createMarker(path);
    verdict = await inspect(path);
  }
  if (verdict !== "ledger") throw new Error(`${path} ${REFUSALS[verdict]}`);
  await createNamedExtras(path);
  const ledger = new Ledger(path, cadence);
  await ledger.ready;
  return ledger;
}

/** Where a writer carries on from. Zeroes start a new directory. */
type Start = { seq: number; segment: number; bytes: number; day: string };
const NEW: Start = { seq: 0, segment: 0, bytes: 0, day: "" };

const nextHlc = (h: Hlc, now: number): Hlc => (now > h.l ? { l: now, c: 0 } : { l: h.l, c: h.c + 1 });

/**
 * Appends to one writer directory. `tick` advances the caller's clock, `written`
 * sees each record once it is on disk. `idle()` settles after every post so far.
 */
function newWriter(
  dir: string,
  start: Start,
  tick: (now: number) => Hlc,
  closed: () => string | undefined,
  written: (e: LogEvent, segment: number, bytes: number) => Event = toEvent,
) {
  const id = basename(dir);
  let { seq, segment, bytes, day } = start;
  let broken: unknown;
  let chain: Promise<unknown> = Promise.resolve();
  const post = (v: number, type: string, payload: unknown) => {
    const why = closed();
    if (why) return Promise.reject(new Error(why));
    const p = chain.then(async () => {
      // A failed append may have left half a record; appending after it would read as damage.
      if (broken) throw new Error("writer broken by an earlier failed write; reopen the ledger", { cause: broken });
      const now = Date.now();
      const hlc = tick(now);
      const date = new Date(now);
      const e: LogEvent = { seq: seq + 1, device: id, hlc, id: randomUUID(), type, v, at: date.toISOString(), payload };
      const rec = encode(e);
      const len = Buffer.byteLength(rec);
      // Never roll an empty segment; a record over the cap gets a segment of its own.
      const roll = segment === 0 || (bytes > 0 && (bytes + len > MAX_SEGMENT_BYTES || localDay(date) !== day));
      try {
        if (roll) {
          if (segment === 0) await mkdir(dir, { recursive: true });
          segment++;
          bytes = 0;
        }
        const fh = await open(join(dir, segmentName(segment)), "a");
        try {
          await fh.writeFile(rec);
          await fh.sync();
        } finally {
          await fh.close();
        }
        if (roll) await fsyncDir(dir);
      } catch (err) {
        broken = err;
        throw err;
      }
      seq++;
      bytes += len;
      day = localDay(date);
      return written(e, segment, bytes);
    });
    chain = p.catch(() => {});
    return p;
  };
  return { writer: { directory: dir, post } as Writer, idle: () => chain };
}

let cachedBootId: string | null | undefined;
function bootId(): string | null {
  if (cachedBootId !== undefined) return cachedBootId;
  try {
    const raw =
      process.platform === "darwin" ? execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8" })
      : process.platform === "linux" ? readFileSync("/proc/sys/kernel/random/boot_id", "utf8")
      : "";
    return (cachedBootId = raw.trim() || null);
  } catch {
    return (cachedBootId = null);
  }
}

/** A UUIDv8 holding the first 122 bits of sha256(parts joined by NUL). */
function uuidv8(parts: string[]) {
  const b = createHash("sha256").update(parts.join("\0")).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Takes the exclusive lock for one writer directory, or returns undefined if this user can't have it now. */
async function lock(name: string, uid: number): Promise<DatabaseSync | undefined> {
  // Per user: on Linux tmpdir() is usually the shared /tmp.
  // The name is frozen, though it names the app. This lock is all that keeps two processes out of one writer
  // directory, so an old build and a new one running at once must take the same lock. Rename it and, for as long
  // as both run, each takes its own and both append to the same directory.
  const folder = join(tmpdir(), `pbnotes-locks-${uid}`);
  try {
    await mkdir(folder, { mode: 0o700 });
  } catch (err: any) {
    if (err.code !== "EEXIST") return;
  }
  try {
    const st = await lstat(folder);
    if (!st.isDirectory() || st.uid !== uid) return;
  } catch {
    return;
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(folder, `${name}.lock`));
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE");
    return db;
  } catch {
    db?.close();
  }
}

/** Where to carry on in `dir`, or undefined if its tail is torn or unreadable. */
async function resumePoint(dir: string): Promise<{ start: Start; hlc: Hlc } | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: any) {
    return err.code === "ENOENT" ? { start: NEW, hlc: { l: 0, c: 0 } } : undefined;
  }
  const segs = names.filter((n) => SEGMENT.test(n)).sort();
  if (!segs.length) return { start: NEW, hlc: { l: 0, c: 0 } };
  let buf: Buffer;
  try {
    // ponytail: reads the whole last segment (up to 16 MiB); read backwards from the end if that gets slow
    buf = await readFile(join(dir, segs.at(-1)!));
  } catch {
    return;
  }
  // An empty segment is torn too: there is no record to carry `seq` on from.
  if (!buf.length || buf[buf.length - 1] !== 10) return;
  const e = decode(buf.toString("utf8", buf.lastIndexOf(10, buf.length - 2) + 1, buf.length - 1));
  if (!e) return;
  const segment = Number(segs.at(-1)!.slice(0, 16));
  return { start: { seq: e.seq, segment, bytes: buf.length, day: localDay(new Date(e.at)) }, hlc: e.hlc };
}

/**
 * Appends to the ledger at `path` without reading it, carrying on in the same
 * writer directory each run for this key (per machine, boot, user and folder).
 * Falls back to a fresh random directory if that one is held or its tail is
 * torn. Never creates a ledger. `options` are for tests: two machines sharing a
 * `bootId` and key would write one directory at once.
 */
export async function openWriter(
  path: string,
  key: string,
  options: { bootId?: string; uid?: number } = {},
): Promise<Writer & AsyncDisposable> {
  const verdict = await inspect(path);
  if (verdict !== "ledger") throw new Error(`${path} ${REFUSALS[verdict]}`);

  const boot = options.bootId ?? bootId();
  const uid = options.uid ?? userInfo().uid;
  let held: DatabaseSync | undefined;
  let resume: { start: Start; hlc: Hlc } | undefined;
  let name: string = randomUUID();
  if (boot !== null) {
    const keyed = uuidv8([boot, String(uid), await realpath(path), key]);
    held = await lock(keyed, uid);
    if (held) resume = await resumePoint(join(path, keyed));
    if (resume) name = keyed;
    else {
      held?.close();
      held = undefined;
    }
  }

  let clock = resume?.hlc ?? { l: 0, c: 0 };
  let disposed = false;
  const { writer, idle } = newWriter(
    join(path, name),
    resume?.start ?? NEW,
    (now) => (clock = nextHlc(clock, now)),
    () => (disposed ? "writer disposed" : undefined),
  );
  return {
    ...writer,
    async [Symbol.asyncDispose]() {
      disposed = true;
      // Hold the lock until every post is on disk, or the next writer could resume mid-record.
      await idle();
      held?.close();
      held = undefined;
    },
  };
}

type Entry = { log: LogEvent; event: Event };
type Sub = { dirty: number; wake: () => void };
/**
 * Read position in one writer directory. Only advanced past records that were accepted or skipped as duplicates.
 * `seen` is what the last read saw, and `changedAt` when that last differed: they decide whether a scan reads it.
 */
type Cursor = {
  seg: number;
  offset: number;
  last: number;
  state: DeviceState;
  detail?: string;
  suspect?: number;
  checkedAt: number;
  changedAt: number;
  seen?: string;
  /** Stray files found in it on the last read. */
  ignored: string[];
};
/** What one read of a directory saw: its segments, and the one it read last, by size. `mtime` is that one's, if any. */
type Seen = { list: string; tail: string; mtime?: number };
/** One scan's time: monotonic for the cadence, wall clock only to age a modification time. */
type Instant = { mono: number; wall: number };

/**
 * A directory's last change, guessed at first sight, in monotonic time. The newest segment's age stands in for it.
 * With no segment to go by (empty, as sync often creates a folder before its files, or unreadable), it counts
 * as just changed: a new session's first segment is about to land.
 */
const firstChange = (mtime: number | undefined, at: Instant) =>
  mtime === undefined ? at.mono : at.mono - Math.max(0, at.wall - mtime);

// ponytail: whole log lives in memory and is re-read on open; add on-disk snapshots when cold start gets slow
export class Ledger {
  readonly ready: Promise<void>;
  #root: string;
  #cadence: Cadence;
  #events: Entry[] = [];
  #cursors = new Map<string, Cursor>();
  #ignored: string[] = [];
  #hlc: Hlc = { l: 0, c: 0 };
  #subs = new Set<Sub>();
  #idle?: () => Promise<unknown>;
  /** Set only while waiting for the next scan. */
  #timer?: ReturnType<typeof setTimeout>;
  /** The last scan asked for; each one waits for the one before it. */
  #polling: Promise<void> = Promise.resolve();
  /** A full scan asked for and not yet started, which a later refresh shares. */
  #queuedFull?: Promise<void>;
  #closed = false;
  #writer?: Writer;

  constructor(root: string, cadence: Cadence) {
    this.#root = root;
    this.#cadence = checkCadence(cadence);
    this.ready = this.#run(true);
  }

  /** Changes the cadence, from the next scan. Throws on a cadence that is not one. */
  pace(cadence: Cadence): void {
    this.#cadence = checkCadence(cadence);
    // Without a timer a scan is running, and it schedules the next one at this pace.
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#schedule();
  }

  /**
   * Scans now, reading every directory, quiet or not. Resolves once that scan is done. Calls made while one is
   * waiting to start share it; one made while it runs gets another, since the running one may have read past a change.
   */
  refresh(): Promise<void> {
    return this.#run(true);
  }

  /** This ledger's one writer; its directory appears on the first `post`. */
  writer(): Writer {
    return (this.#writer ??= this.#newWriter());
  }

  #newWriter(): Writer {
    const { writer, idle } = newWriter(
      join(this.#root, randomUUID()),
      NEW,
      (now) => (this.#hlc = nextHlc(this.#hlc, now)),
      () => (this.#closed ? "ledger closed" : undefined),
      (e, segment, bytes) => {
        // A concurrent scan may already have read this record; only one of us ingests it.
        const c = this.#cursor(e.device);
        if (e.seq <= c.last) return toEvent(e);
        Object.assign(c, { seg: segment, offset: bytes, last: e.seq });
        const entry = { log: e, event: toEvent(e) };
        this.#ingest([entry]);
        return entry.event;
      },
    );
    this.#idle = idle;
    return writer;
  }

  /**
   * Yields the folded state after catch-up and after every change. When a late
   * event sorts into the past, it refolds from the nearest checkpoint, so a
   * yielded state is not always a successor of the previous one. `reduce` must
   * be pure and must not mutate `previous`: checkpoints hold on to it.
   */
  async *onEvent<T>(base: T, reduce: (previous: T, event: Event) => T): AsyncIterable<T> {
    const sub: Sub = { dirty: 0, wake: () => {} };
    // cps[k] = state after folding events[0, cps[k].i)
    const cps = [{ i: 0, s: base }];
    this.#subs.add(sub);
    try {
      while (!this.#closed) {
        if (sub.dirty === Infinity) {
          await new Promise<void>((r) => (sub.wake = r));
          continue;
        }
        const from = sub.dirty;
        sub.dirty = Infinity;
        while (cps.at(-1)!.i > from) cps.pop();
        let { i, s } = cps.at(-1)!;
        for (; i < this.#events.length; i++) {
          s = reduce(s, this.#events[i].event);
          if ((i + 1) % CHECKPOINT_EVERY === 0) cps.push({ i: i + 1, s });
        }
        yield s;
      }
    } finally {
      this.#subs.delete(sub);
    }
  }

  get status(): LogStatus {
    const devices = [...this.#cursors]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([device, c]): DeviceStatus => {
        if (c.state === "ok" && c.suspect !== undefined)
          return { device, folded: c.last, state: "clockSuspect", detail: `dated ${new Date(c.suspect).toISOString()}` };
        return c.detail === undefined
          ? { device, folded: c.last, state: c.state }
          : { device, folded: c.last, state: c.state, detail: c.detail };
      });
    return { devices, ignored: [...this.#ignored] };
  }

  async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#timer);
    await this.#polling;
    await this.#idle?.();
    for (const s of this.#subs) s.wake();
  }

  #cursor(device: string): Cursor {
    let c = this.#cursors.get(device);
    if (!c) {
      c = { seg: 1, offset: 0, last: 0, state: "ok", checkedAt: -Infinity, changedAt: -Infinity, ignored: [] };
      this.#cursors.set(device, c);
    }
    return c;
  }

  /** Queues a scan behind any running one, and schedules the next once it is done, unless another was queued. */
  #run(all: boolean): Promise<void> {
    if (all && this.#queuedFull) return this.#queuedFull;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const run: Promise<void> = this.#polling
      .catch(() => {})
      .then(async () => {
        if (this.#queuedFull === run) this.#queuedFull = undefined;
        if (this.#closed) return;
        await this.#scan(all);
        if (this.#polling === run) this.#schedule();
      });
    if (all) this.#queuedFull = run;
    this.#polling = run;
    return run;
  }

  #schedule() {
    if (!this.#closed) this.#timer = setTimeout(() => void this.#run(false), this.#cadence.everyMs);
  }

  // Polling, not fs.watch: watch events are unreliable inside sync clients.
  async #scan(all: boolean) {
    let top: Dirent[];
    try {
      top = await readdir(this.#root, { withFileTypes: true });
    } catch {
      return; // ponytail: root unlistable keeps the last view; LogStatus has no slot for it
    }
    top.sort((a, b) => (a.name < b.name ? -1 : 1));
    const at: Instant = { mono: performance.now(), wall: Date.now() };
    const ignored: string[] = [];
    const fresh: LogEvent[] = [];
    for (const d of top) {
      if (hidden(d.name)) continue;
      if (d.isDirectory()) {
        const c = this.#cursor(d.name);
        if (all || due(c, at.mono, this.#cadence)) await this.#readWriter(d.name, c, at, fresh);
        ignored.push(...c.ignored); // a directory not read this time still has the strays it had
      } else if (d.name !== "LEDGER" && !named(d)) ignored.push(join(this.#root, d.name));
    }
    this.#ignored = ignored;
    this.#ingest(fresh.map((e) => ({ log: e, event: toEvent(e) })));
  }

  /**
   * Every directory is foreign here, even one a writer is appending to: never truncate, never throw. A stop
   * leaves the cursor at the last good record and is retried on the next read,
   * so gaps that sync fills clear by themselves. Sync filling one is a change,
   * so the directory is read on every scan while it heals.
   */
  async #readWriter(device: string, c: Cursor, at: Instant, out: LogEvent[]) {
    const seen: Seen = { list: "", tail: "", mtime: undefined };
    try {
      await this.#readSegments(join(this.#root, device), c, seen, at, out);
    } finally {
      c.checkedAt = at.mono;
      const key = `${seen.list}|${seen.tail}`;
      if (c.seen === undefined) c.changedAt = firstChange(seen.mtime, at);
      else if (key !== c.seen) c.changedAt = at.mono;
      c.seen = key;
    }
  }

  /**
   * Lists `dir` and reads its segments from the cursor, one after the next,
   * until one stops short or the next is not there. What the bytes of each
   * mean is `readRecords`; this reads them, and moves the cursor by what it
   * says.
   */
  async #readSegments(dir: string, c: Cursor, seen: Seen, at: Instant, out: LogEvent[]) {
    c.ignored = [];
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      seen.list = "unavailable";
      Object.assign(c, { state: "unavailable", detail: String(err?.message ?? err) });
      return;
    }
    const segs = new Set<number>();
    for (const e of entries) {
      if (hidden(e.name) || !e.isFile()) continue; // subdirectories hold side files: not read, not reported
      if (SEGMENT.test(e.name)) segs.add(Number(e.name.slice(0, 16)));
      else c.ignored.push(join(dir, e.name));
    }
    seen.list = [...segs].sort((a, b) => a - b).join(",");
    c.state = "ok";
    c.detail = undefined;
    const stall = (seg: number, at: number, why: string) =>
      Object.assign(c, { state: "stalled", detail: `${segmentName(seg)} at byte ${at}: ${why}` });

    // The move to the next segment is only committed once one of its records is accepted.
    for (let seg = c.seg, start = c.offset; ; seg++, start = 0) {
      if (!segs.has(seg)) {
        const later = [...segs].filter((n) => n > seg);
        if (later.length) stall(Math.min(...later), 0, "follows a missing one");
        return;
      }
      let buf: Buffer;
      try {
        const fh = await open(join(dir, segmentName(seg)), "r");
        try {
          const { size, mtimeMs } = await fh.stat();
          seen.tail = `${seg}:${size}`;
          seen.mtime = mtimeMs;
          buf = Buffer.alloc(Math.max(0, size - start));
          buf = buf.subarray(0, (await fh.read(buf, 0, buf.length, start)).bytesRead);
        } finally {
          await fh.close();
        }
      } catch (err: any) {
        Object.assign(c, { state: "unavailable", detail: String(err?.message ?? err) });
        return;
      }
      const read = readRecords(buf, start, c.last, at.wall + MAX_CLOCK_SKEW_MS);
      // A loop, not a spread: a full segment holds more records than a call takes arguments.
      for (const e of read.accepted) out.push(e);
      c.last = read.last;
      if (read.suspect !== undefined) c.suspect = Math.max(c.suspect ?? 0, read.suspect);
      if (read.end !== undefined) {
        c.seg = seg;
        c.offset = read.end;
      }
      if (read.stall) return stall(seg, read.stall.at, read.stall.why);
    }
  }

  #ingest(fresh: Entry[]) {
    if (!fresh.length) return;
    const now = Date.now();
    let min = fresh[0];
    for (const x of fresh) {
      const e = x.log;
      if (e.hlc.l <= now + MAX_CLOCK_SKEW_MS && cmpHlc(e.hlc, this.#hlc) > 0) this.#hlc = e.hlc;
      if (cmp(e, min.log) < 0) min = x;
      this.#events.push(x);
    }
    // ponytail: full sort per batch (cheap on nearly-sorted arrays); k-way merge if posts get hot
    this.#events.sort((a, b) => cmp(a.log, b.log));
    const from = this.#events.indexOf(min);
    for (const s of this.#subs) {
      s.dirty = Math.min(s.dirty, from);
      s.wake();
    }
  }
}
