import { mkdir, open, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";

// On-disk format 1. Must stay byte-compatible with existing ledgers.

export type Hlc = { l: number; c: number };

export type LogEvent<T = unknown> = {
  /** 1, 2, 3… gap-free within one writer directory. Detects damage; does not order. */
  seq: number;
  /** The writer directory (one writing session). Named `device` for format compatibility. */
  device: string;
  /** Orders the merged log (ties broken by `device`). */
  hlc: Hlc;
  id: string;
  type: string;
  v: number;
  /** Wall clock, for display only. */
  at: string;
  payload: T;
};

/** What consumers see. Fold order already encodes `hlc`, so a reducer that overwrites gets last-writer-wins. */
export type Event<T = unknown> = Pick<LogEvent<T>, "type" | "v" | "at" | "payload">;

export type Writer = {
  id: string;
  post(v: number, type: string, payload: unknown): Promise<Event>;
};

export type DeviceState = "ok" | "stalled" | "unavailable" | "clockSuspect";
export type DeviceStatus = { device: string; /** last seq folded */ folded: number; state: DeviceState; detail?: string };
export type LogStatus = { devices: DeviceStatus[]; /** absolute paths */ ignored: string[] };

export type Verdict = "ledger" | "newer" | "not-a-ledger" | "missing" | "unmarked";

const FORMAT = 1;
const SIGNATURE = "bULhVFqraHDHescwKKhK0g==";
const MARKER = `Signature: ${SIGNATURE}
# This folder is an append-only event ledger. Each subfolder belongs to one
# writing session. Do not edit, rename or delete anything here by hand.
read ${FORMAT}
write ${FORMAT}
`;
const SEGMENT = /^\d{16}\.log$/;
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
const hex8 = (s: string) => crc32(s).toString(16).padStart(8, "0");

/** `<crc32 of the JSON, 8 hex> <JSON>\n` */
export const encode = (e: LogEvent) => {
  const json = JSON.stringify(e);
  return `${hex8(json)} ${json}\n`;
};

function decode(line: string): LogEvent | undefined {
  if (line[8] !== " ") return;
  const json = line.slice(9);
  if (hex8(json) !== line.slice(0, 8)) return;
  let e: any;
  try {
    e = JSON.parse(json);
  } catch {
    return;
  }
  return typeof e?.seq === "number" && typeof e.device === "string" &&
    typeof e.hlc?.l === "number" && typeof e.hlc.c === "number" ? e : undefined;
}

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
    const visible = entries.filter((e) => !e.name.startsWith("."));
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

async function createMarker(path: string) {
  await mkdir(path, { recursive: true });
  let fh;
  try {
    fh = await open(join(path, "LEDGER"), "wx");
  } catch (err: any) {
    if (err.code === "EEXIST") return; // someone beat us to it; inspect() judges theirs
    throw err;
  }
  try {
    await fh.writeFile(MARKER);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

const REFUSALS: Record<Exclude<Verdict, "ledger" | "missing">, string> = {
  newer: "was written by a newer ledger format; upgrade to open it",
  unmarked: "holds ledger segments but no LEDGER marker; refusing to touch it",
  "not-a-ledger": "is not a ledger (or its LEDGER marker is malformed); refusing to write into it",
};

export async function openOrCreate(path: string, pollMs = 1000): Promise<Ledger> {
  let verdict = await inspect(path);
  if (verdict === "missing") {
    await createMarker(path);
    verdict = await inspect(path);
  }
  if (verdict !== "ledger") throw new Error(`${path} ${REFUSALS[verdict as keyof typeof REFUSALS]}`);
  const ledger = new Ledger(path, pollMs);
  await ledger.ready;
  return ledger;
}

type Entry = { log: LogEvent; event: Event };
type Sub = { dirty: number; wake: () => void };
/** Read position in one writer directory. Only advanced past records that were accepted or skipped as duplicates. */
type Cursor = { seg: number; offset: number; last: number; state: DeviceState; detail?: string; suspect?: number };

// ponytail: whole log lives in memory and is re-read on open; add on-disk snapshots when cold start gets slow
export class Ledger {
  readonly ready: Promise<void>;
  #root: string;
  #pollMs: number;
  #events: Entry[] = [];
  #cursors = new Map<string, Cursor>();
  #ignored: string[] = [];
  #hlc: Hlc = { l: 0, c: 0 };
  #subs = new Set<Sub>();
  #pending = new Set<Promise<unknown>>();
  #timer?: ReturnType<typeof setTimeout>;
  #polling: Promise<void>;
  #closed = false;
  #writer?: Writer;

  constructor(root: string, pollMs: number) {
    this.#root = root;
    this.#pollMs = pollMs;
    this.ready = this.#polling = this.#tick();
  }

  /** This ledger's one writer; its directory appears on the first `post`. */
  writer(): Writer {
    return (this.#writer ??= this.#newWriter());
  }

  #newWriter(): Writer {
    const id = randomUUID();
    const dir = join(this.#root, id);
    let seq = 0;
    let segment = 0;
    let bytes = 0;
    let day = "";
    let broken: unknown;
    let chain: Promise<unknown> = Promise.resolve();
    const post = (v: number, type: string, payload: unknown) => {
      if (this.#closed) return Promise.reject(new Error("ledger closed"));
      const p = chain.then(async () => {
        // A failed append may have left half a record; appending after it would read as damage.
        if (broken) throw new Error("writer broken by an earlier failed write; reopen the ledger", { cause: broken });
        const now = Date.now();
        const hlc = (this.#hlc = now > this.#hlc.l ? { l: now, c: 0 } : { l: this.#hlc.l, c: this.#hlc.c + 1 });
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
        // A concurrent scan may already have read this record; only one of us ingests it.
        const c = this.#cursor(id);
        if (e.seq <= c.last) return toEvent(e);
        Object.assign(c, { seg: segment, offset: bytes, last: e.seq });
        const entry = { log: e, event: toEvent(e) };
        this.#ingest([entry]);
        return entry.event;
      });
      chain = p.catch(() => {});
      this.#pending.add(chain);
      chain.then(() => this.#pending.delete(chain));
      return p;
    };
    return { id, post };
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
    await Promise.allSettled(this.#pending);
    for (const s of this.#subs) s.wake();
  }

  #cursor(device: string): Cursor {
    let c = this.#cursors.get(device);
    if (!c) this.#cursors.set(device, (c = { seg: 1, offset: 0, last: 0, state: "ok" }));
    return c;
  }

  async #tick(): Promise<void> {
    await this.#scan();
    if (!this.#closed) this.#timer = setTimeout(() => (this.#polling = this.#tick()), this.#pollMs);
  }

  // Polling, not fs.watch: watch events are unreliable inside sync clients.
  async #scan() {
    let top: Dirent[];
    try {
      top = await readdir(this.#root, { withFileTypes: true });
    } catch {
      return; // ponytail: root unlistable keeps the last view; LogStatus has no slot for it
    }
    top.sort((a, b) => (a.name < b.name ? -1 : 1));
    const ignored: string[] = [];
    const fresh: LogEvent[] = [];
    for (const d of top) {
      if (d.isDirectory()) await this.#readWriter(d.name, ignored, fresh);
      else if (d.name !== "LEDGER") ignored.push(join(this.#root, d.name));
    }
    this.#ignored = ignored;
    this.#ingest(fresh.map((e) => ({ log: e, event: toEvent(e) })));
  }

  /**
   * Every directory is foreign here (#45): never truncate, never throw. A stop
   * leaves the cursor at the last good record and is retried on the next poll,
   * so gaps that sync fills clear by themselves.
   */
  async #readWriter(device: string, ignored: string[], out: LogEvent[]) {
    const dir = join(this.#root, device);
    const c = this.#cursor(device);
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      Object.assign(c, { state: "unavailable", detail: String(err?.message ?? err) });
      return;
    }
    const segs = new Set<number>();
    for (const e of entries) {
      if (!e.isFile()) continue; // subdirectories hold side files: not read, not reported
      if (SEGMENT.test(e.name)) segs.add(Number(e.name.slice(0, 16)));
      else ignored.push(join(dir, e.name));
    }
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
          const { size } = await fh.stat();
          buf = Buffer.alloc(Math.max(0, size - start));
          buf = buf.subarray(0, (await fh.read(buf, 0, buf.length, start)).bytesRead);
        } finally {
          await fh.close();
        }
      } catch (err: any) {
        Object.assign(c, { state: "unavailable", detail: String(err?.message ?? err) });
        return;
      }
      let i = 0;
      let firstBad = -1;
      for (let nl; (nl = buf.indexOf(10, i)) >= 0; ) {
        const at = start + i;
        const e = decode(buf.toString("utf8", i, nl));
        i = nl + 1;
        if (!e) {
          if (firstBad < 0) firstBad = at;
          continue;
        }
        if (firstBad >= 0) return stall(seg, firstBad, "intact records follow it");
        if (e.seq > c.last + 1) return stall(seg, at, `jumps from seq ${c.last} to ${e.seq}`);
        if (e.seq === c.last + 1) {
          c.last = e.seq;
          out.push(e);
          if (e.hlc.l > Date.now() + MAX_CLOCK_SKEW_MS) c.suspect = Math.max(c.suspect ?? 0, e.hlc.l);
        } // else seq <= last: duplicate delivery, skip but count its bytes
        c.seg = seg;
        c.offset = start + i;
      }
      // A bad or unterminated last record: may still be syncing, or the session crashed mid-write.
      if (firstBad >= 0 || i < buf.length)
        return stall(seg, firstBad >= 0 ? firstBad : start + i, "torn tail (may be from a crash)");
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
