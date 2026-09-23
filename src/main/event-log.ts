/**
 * An append-only event log: the system of record for project content.
 *
 * Events are facts that already happened, so they are never rewritten and
 * never deleted. Anything the app needs to *read* is a projection — a view
 * folded out of the log at boot and kept in memory. Projections are
 * disposable and can be reshaped freely; the log cannot, which is why every
 * event carries a schema version (see `LogEvent.v`).
 *
 * Deliberately not SQLite: this is a domain-specific record of what the user
 * did, not a generic store whose only goal is to build tables. The projects
 * registry is the opposite case and stays in SQLite — see `db.ts`.
 *
 * Main process only. The log is a directory *per device*, each holding
 * numbered segments, one record per line:
 *
 *     <crc32, 8 hex chars><space><json>\n
 *
 * Text so the log stays greppable with `tail` and `jq`, with the checksum
 * outside the JSON so verification covers the exact bytes on disk rather than
 * a re-serialisation of them (which would depend on key ordering).
 *
 * **One writer per file, forever.** A device appends only inside its own
 * directory, which is what makes the folder safe to hand to a sync tool: two
 * machines never touch the same path, so there is no divergence for Dropbox to
 * resolve and no conflicted copy to lose. See `docs/multi-writer.md`.
 *
 * Only the newest segment of a device is written to; the rest are sealed.
 * `seq` counts within one device and detects damage there. Order across
 * devices is the hybrid logical clock's job — see `compare`.
 */
import {
  open,
  mkdir,
  readdir,
  truncate,
  stat,
  appendFile,
} from 'node:fs/promises';
import { createReadStream, watch as watchFs } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { DeviceStatus, LogStatus } from '../shared/log.ts';

export type { DeviceStatus, LogStatus };

/**
 * A hybrid logical clock: wall-clock milliseconds that are forbidden from
 * falling below anything already seen, with a counter for the ties that
 * produces.
 *
 * Wall clock alone cannot order a log — clocks drift and get set wrong. A
 * plain counter cannot either, because a device that has never read the folder
 * starts at zero and files a note written today underneath a year of history
 * it has not downloaded yet. `l` floored by what we have seen is right in both
 * directions.
 */
export type Hlc = { l: number; c: number };

export type LogEvent<T = unknown> = {
  /** Gap-free *within this device's log*. Detects damage; does not order. */
  seq: number;
  /** Which device wrote it, and the directory it lives in. */
  device: string;
  /** Orders the merged log. */
  hlc: Hlc;
  id: string;
  /** Domain event name, e.g. `note.written`. */
  type: string;
  /**
   * Schema version of *this event type's* payload. History cannot be
   * rewritten, so a payload shape that changes is handled by upcasting on
   * read: branch on `v` when folding, and leave what is on disk alone.
   */
  v: number;
  /**
   * Wall clock, for display only. Deliberately not `hlc.l`, which is a clock
   * that has been clamped and is therefore sometimes not the time.
   */
  at: string;
  payload: T;
};

const CRC_WIDTH = 8;

/**
 * Segment names are a zero-padded decimal count: `0000000000000001.log`.
 *
 * Sixteen digits, because `ls`, `readdir` and every archive tool sort names as
 * text, and a number that is padded to a fixed width sorts the same way it
 * counts. Sixteen already runs past `Number.MAX_SAFE_INTEGER`, so going wider
 * would only buy digits that arithmetic here could not represent anyway.
 */
export const SEGMENT_DIGITS = 16;

/**
 * Roll at 16 MiB or at a local-day boundary, whichever lands first. Size keeps
 * any one file small enough to read, copy or lose on its own; the daily cut
 * means a segment is a day's work, which is the unit a human reaches for when
 * they go looking through what they wrote.
 */
export const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;

/**
 * How far ahead of our own clock an event may be dated and still raise ours.
 *
 * Without a bound, a floor that only rises is a trap: one machine with its
 * clock set to 2031 writes a single event, every device that reads it adopts
 * that value and persists it, and from then on the clock is a plain counter —
 * so the next device to join, with a correct clock, sorts before everything.
 *
 * Generous on purpose. Real skew between consumer machines is seconds; a day
 * is far outside that and still far inside "the clock is set to the wrong
 * year".
 */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const SEGMENT_PATTERN = new RegExp(`^\\d{${SEGMENT_DIGITS}}\\.log$`);

export function segmentName(number: number): string {
  return `${String(number).padStart(SEGMENT_DIGITS, '0')}.log`;
}

/**
 * The merged order: `(hlc.l, hlc.c, device)`. Every machine computes the same
 * order from the same set of events, which is the whole point — convergence
 * comes from replaying in one agreed order, not from operations that commute.
 */
export function compare(a: LogEvent, b: LogEvent): number {
  return compareHlc(a.hlc, b.hlc) || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0);
}

/** The clock alone, for raising ours against an event we just read. */
export function compareHlc(a: Hlc, b: Hlc): number {
  return a.l !== b.l ? a.l - b.l : a.c - b.c;
}

/**
 * The local calendar day a moment falls in. Local, not UTC: "a day" means the
 * user's day, and segmenting on Greenwich's midnight would cut the file in the
 * middle of their afternoon.
 */
function dayOf(at: Date | string): string {
  const when = typeof at === 'string' ? new Date(at) : at;
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${when.getFullYear()}-${month}-${day}`;
}

function checksum(json: string): string {
  return crc32(json).toString(16).padStart(CRC_WIDTH, '0');
}

function encode(event: LogEvent): string {
  const json = JSON.stringify(event);
  return `${checksum(json)} ${json}\n`;
}

/** Returns null for anything that is not an intact, well-shaped record. */
function decode(line: string): LogEvent | null {
  if (line[CRC_WIDTH] !== ' ') return null;
  const json = line.slice(CRC_WIDTH + 1);
  if (checksum(json) !== line.slice(0, CRC_WIDTH)) return null;
  try {
    const event = JSON.parse(json) as LogEvent;
    // The checksum proves the bytes are the bytes that were written. It says
    // nothing about what wrote them, and an event with no clock would poison
    // the merge, so the envelope is checked too.
    if (
      typeof event.seq !== 'number' ||
      typeof event.device !== 'string' ||
      typeof event.hlc?.l !== 'number' ||
      typeof event.hlc?.c !== 'number'
    ) {
      return null;
    }
    return event;
  } catch {
    return null;
  }
}

/** `write` is allowed to write fewer bytes than it was given. */
async function writeAll(handle: FileHandle, buffer: Buffer): Promise<void> {
  for (let offset = 0; offset < buffer.length; ) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
    );
    offset += bytesWritten;
  }
}

/**
 * Flushing the directory entry matters as much as flushing the contents:
 * without it a power cut can lose the file itself. Windows does not let a
 * directory be opened, and does not need this.
 */
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class LogCorruptError extends Error {
  // A plain field rather than a parameter property: Node strips types from
  // `.ts` files by erasing them, and parameter properties are not erasable.
  byte: number;

  constructor(byte: number, message: string) {
    super(message);
    this.name = 'LogCorruptError';
    this.byte = byte;
  }
}

/**
 * Where a replay gave up. `torn` marks the one case the owner of a file may
 * repair: a half-written record at the very end, which is what a crash
 * mid-append leaves behind.
 */
type Stop = { at: number; why: string; torn: boolean };

/** What one device's directory yielded, and how far it could be read. */
type DeviceRead = {
  status: DeviceStatus;
  /** Newest segment number, and its size once any torn tail is cut off. */
  number: number;
  bytes: number;
  day: string | null;
};

/**
 * Replays one segment, yielding intact records and reporting where it stopped.
 *
 * The distinction that drives everything: a bad record at the *end* of a file
 * is a torn write, while a bad record with intact records after it is real
 * damage. Only the owner of a file may act on that distinction — see
 * `readDevice`.
 */
async function* readSegment(
  file: string,
  from: { seq: number; bytes: number; day: string | null },
  stop: Stop | null,
): AsyncGenerator<LogEvent, Stop | null> {
  from.bytes = 0;
  let firstBad = -1;
  let why = '';

  const lines = createInterface({ input: createReadStream(file) });
  for await (const line of lines) {
    const event = decode(line);

    if (firstBad !== -1) {
      // Intact records after a bad one: this is damage, not a torn tail.
      if (event) {
        return { at: firstBad, why: 'intact records follow it', torn: false };
      }
      continue;
    }
    if (!event) {
      firstBad = from.bytes;
      why = 'unreadable record';
      continue;
    }
    if (event.seq <= from.seq) {
      // A file delivered twice — a restored copy, a folder copied in. The
      // bytes still count, or a repair would cut into good records.
      from.bytes += Buffer.byteLength(line) + 1;
      continue;
    }
    if (event.seq !== from.seq + 1) {
      return {
        at: from.bytes,
        why: `jumps from seq ${from.seq} to ${event.seq}`,
        torn: false,
      };
    }

    yield event;
    from.seq = event.seq;
    from.day = dayOf(event.at);
    from.bytes += Buffer.byteLength(line) + 1;
  }

  return firstBad === -1 ? stop : { at: firstBad, why, torn: true };
}

/**
 * Replays one device's directory in `seq` order.
 *
 * `own` decides what a damaged file means. Our own log can only be torn by our
 * own crash, so the tail is repaired exactly as it always was. **A foreign log
 * is never written to**, because under a sync tool "the tail has not arrived
 * yet" is a routine state and truncating it would make a transient permanent.
 * A foreign log stalls instead: fold what is intact, stop there, try again
 * when something changes.
 */
async function* readDevice(
  directory: string,
  device: string,
  own: boolean,
  out: DeviceRead,
  ignored: string[],
): AsyncGenerator<LogEvent> {
  let names: string[];
  try {
    names = (await readdir(directory)).sort();
  } catch (error) {
    // Selective sync, an online-only placeholder, a directory that went away
    // mid-read. None of these are damage; they are "not here yet".
    out.status.state = 'unavailable';
    out.status.detail = (error as Error).message;
    return;
  }

  const segments = names.filter((name) => SEGMENT_PATTERN.test(name));
  for (const name of names) {
    if (!segments.includes(name)) ignored.push(path.join(directory, name));
  }

  const from = { seq: 0, bytes: 0, day: null as string | null };
  let stopped: Stop | null = null;

  for (const [index, name] of segments.entries()) {
    const number = Number(name.slice(0, SEGMENT_DIGITS));
    // A hole in the numbering is a segment still in flight, not a hole in
    // history — but folding past it would build a view whose events are
    // missing their causes, which is worse than showing less.
    if (number !== out.number + 1) {
      stopped = {
          at: 0,
          why: `segment ${name} follows a missing one`,
          torn: false,
        };
      break;
    }
    out.number = number;

    const file = path.join(directory, name);
    const last = index === segments.length - 1;
    stopped = yield* readSegment(file, from, stopped);
    out.bytes = from.bytes;
    out.day = from.day ?? out.day;

    if (!stopped) {
      // A crash between a record and its newline: `readline` hands the line
      // over either way, so the record is intact and counted, but the file is
      // one byte shorter than `bytes` says. Put the newline back, or the next
      // append lands on the same line and destroys a record already saved.
      if (own && last && from.bytes > (await logSize(file))) {
        await appendFile(file, '\n');
      }
      continue;
    }

    if (own) {
      // Only the newest segment can hold a torn tail, because it is the only
      // one we ever write to, and only a half-written record at the end *is*
      // one. A sequence that jumps, or intact records after a bad one, is
      // damage — truncating there would throw away what the user did next.
      if (!last || !stopped.torn) {
        throw new LogCorruptError(
          stopped.at,
          `Log damaged at byte ${stopped.at} of ${name}: ${stopped.why}.`,
        );
      }
      await truncate(file, from.bytes);
      stopped = null;
      continue;
    }

    out.status.state = 'stalled';
    out.status.detail = `${name} at byte ${stopped.at}: ${stopped.why}`;
    break;
  }

  out.status.folded = from.seq;
}

/**
 * A k-way merge, not a sort. Within one device the clock only ever advances,
 * so every device's log is already in merged order and the fold needs to hold
 * one record per device rather than all of history.
 */
async function* mergeStreams(
  streams: AsyncGenerator<LogEvent>[],
): AsyncGenerator<LogEvent> {
  const heads = await Promise.all(streams.map((it) => it.next()));
  for (;;) {
    let pick = -1;
    for (let i = 0; i < heads.length; i++) {
      const head = heads[i];
      if (head.done) continue;
      if (pick === -1 || compare(head.value, heads[pick].value as LogEvent) < 0) {
        pick = i;
      }
    }
    if (pick === -1) return;
    yield heads[pick].value as LogEvent;
    heads[pick] = await streams[pick].next();
  }
}

function ignore(): void {
  // Opening a log purely to append to it is legitimate; history still has to
  // be replayed first, but the caller has nothing to fold it into.
}

/** What this device remembers between sessions, held in `notes.db`. */
export type DeviceMemory = {
  /** Highest clock observed, so a folder that loses files cannot rewind it. */
  clock: Hlc;
  /** The tip we last appended. A log that runs past it has another writer. */
  tip: { segment: number; seq: number } | null;
};

export type LogOptions = {
  /**
   * This machine's identity, and the directory it writes in. Defaults to a
   * fresh id per process, which is right for tests and visible litter in
   * production — call sites that mean it pass one from `notes.db`.
   */
  device?: string;
  memory?: DeviceMemory;
  /** Persists the clock and tip after every append. */
  remember?: (memory: DeviceMemory) => void;
  /**
   * Mints a new device id. Called when another machine turns out to be writing
   * in our directory; the response is to move rather than to argue.
   */
  rotate?: () => string;
  /** Defaults to `MAX_SEGMENT_BYTES`. Lowered by tests to force a roll. */
  maxSegmentBytes?: number;
  /** The clock, injectable so the daily roll can be tested without waiting. */
  now?: () => Date;
};

export class EventLog {
  #directory: string;
  #device: string;
  #handle: FileHandle;
  #seq: number;
  #clock: Hlc;
  #status: LogStatus;
  /** Which segment is open for appending. */
  #number: number;
  /** Bytes in that segment, tracked rather than re-stat'd on every append. */
  #bytes: number;
  /** The local day it holds, so the next append knows the date rolled over. */
  #day: string;
  #options: LogOptions;
  #maxSegmentBytes: number;
  #now: () => Date;
  /** Serialises appends so sequence numbers and writes cannot interleave. */
  #tail: Promise<unknown> = Promise.resolve();

  private constructor(state: {
    directory: string;
    device: string;
    handle: FileHandle;
    seq: number;
    clock: Hlc;
    status: LogStatus;
    number: number;
    bytes: number;
    day: string;
    options: LogOptions;
  }) {
    this.#directory = state.directory;
    this.#device = state.device;
    this.#handle = state.handle;
    this.#seq = state.seq;
    this.#clock = state.clock;
    this.#status = state.status;
    this.#number = state.number;
    this.#bytes = state.bytes;
    this.#day = state.day;
    this.#options = state.options;
    this.#maxSegmentBytes = state.options.maxSegmentBytes ?? MAX_SEGMENT_BYTES;
    this.#now = state.options.now ?? (() => new Date());
  }

  /**
   * Replays every device's segments into `apply`, in merged order, then opens
   * this device's newest segment for appending. Reading and writing are one
   * call on purpose: appending before recovery would write past a torn tail
   * and bake the damage in — and, now that there are several writers, it is
   * also what makes the clock correct, because a device that appends before it
   * reads has no idea what it is appending after.
   */
  static async open(
    directory: string,
    apply: (event: LogEvent) => void = ignore,
    options: LogOptions = {},
  ): Promise<EventLog> {
    await mkdir(directory, { recursive: true });

    let device = options.device ?? randomUUID();
    // Ours before the replay reads it: a directory that is merely not there
    // yet would otherwise report itself as a device we could not read, which
    // is the one thing a brand new folder is not.
    await mkdir(path.join(directory, device), { recursive: true });
    let scan = await EventLog.#replay(directory, device, options, apply);

    // Another machine writing in our directory means our identity was cloned —
    // a restored backup, a copied VM. Moving is free and losing events is not,
    // so we mint a new id and read the old directory as somebody else's.
    if (scan.duplicate && options.rotate) {
      device = options.rotate();
      await mkdir(path.join(directory, device), { recursive: true });
      scan = await EventLog.#replay(directory, device, options, apply);
    }

    const deviceDirectory = path.join(directory, device);
    // O_APPEND: the offset is chosen at write time, so a write can never land
    // anywhere but the end.
    const handle = await open(
      path.join(deviceDirectory, segmentName(scan.own.number || 1)),
      'a',
    );
    await syncDirectory(deviceDirectory);

    return new EventLog({
      directory,
      device,
      handle,
      seq: scan.own.status.folded,
      clock: scan.clock,
      status: scan.status,
      number: scan.own.number || 1,
      bytes: scan.own.bytes,
      day: scan.own.day ?? dayOf(options.now?.() ?? new Date()),
      options,
    });
  }

  /**
   * One pass over the folder: every device's log, merged, with the clock
   * raised as it goes. Used for the initial load and for every re-fold after
   * something on disk changed.
   */
  static async #replay(
    directory: string,
    device: string,
    options: LogOptions,
    apply: (event: LogEvent) => void,
  ): Promise<{
    own: DeviceRead;
    status: LogStatus;
    clock: Hlc;
    duplicate: boolean;
  }> {
    const entries = await readdir(directory, { withFileTypes: true });
    const ignored = entries
      .filter((entry) => !entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
    const devices = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (!devices.includes(device)) devices.push(device);

    const reads = new Map<string, DeviceRead>();
    const streams = devices.map((name) => {
      const read: DeviceRead = {
        status: { device: name, folded: 0, state: 'ok' },
        number: 0,
        bytes: 0,
        day: null,
      };
      reads.set(name, read);
      return readDevice(
        path.join(directory, name),
        name,
        name === device,
        read,
        ignored,
      );
    });

    const floor = options.memory?.clock ?? { l: 0, c: 0 };
    const clock: Hlc = { ...floor };
    const horizon = (options.now?.() ?? new Date()).getTime() + MAX_CLOCK_SKEW_MS;

    for await (const event of mergeStreams(streams)) {
      apply(event);
      // An event dated years ahead is still the user's, so it is folded — but
      // it does not get to move our clock, or one wrong machine poisons the
      // ordering for every device, permanently.
      if (event.hlc.l > horizon) {
        const status = reads.get(event.device)?.status;
        if (status && status.state === 'ok') {
          status.state = 'clockSuspect';
          status.detail = `dated ${new Date(event.hlc.l).toISOString()}`;
        }
        continue;
      }
      if (compareHlc(clock, event.hlc) < 0) {
        clock.l = event.hlc.l;
        clock.c = event.hlc.c;
      }
    }

    const own = reads.get(device) as DeviceRead;
    const tip = options.memory?.tip;
    // Records in our own file that we did not write. A crash between the
    // log's fsync and the note in `notes.db` looks the same, which is fine:
    // rotating costs a directory, and being wrong about this costs events.
    const duplicate =
      tip !== undefined &&
      tip !== null &&
      (own.number > tip.segment ||
        (own.number === tip.segment && own.status.folded > tip.seq));

    return {
      own,
      status: { devices: [...reads.values()].map((it) => it.status), ignored },
      clock,
      duplicate,
    };
  }

  get seq(): number {
    return this.#seq;
  }

  get device(): string {
    return this.#device;
  }

  get status(): LogStatus {
    return this.#status;
  }

  /** The segment currently open for appending. */
  get segment(): number {
    return this.#number;
  }

  /**
   * Re-reads the whole folder and folds it into `apply` from scratch.
   *
   * Full rather than incremental because a remote event can sort anywhere,
   * including before events already folded, so the view has to be rebuilt
   * rather than extended. Queued behind any append in flight, so a write
   * cannot be lost to a fold that started before it.
   */
  replay(apply: (event: LogEvent) => void): Promise<LogStatus> {
    const run = this.#tail.then(async () => {
      const scan = await EventLog.#replay(
        this.#directory,
        this.#device,
        { ...this.#options, memory: { clock: this.#clock, tip: null } },
        apply,
      );
      this.#status = scan.status;
      this.#clock = scan.clock;
      this.#seq = scan.own.status.folded;
      return scan.status;
    });
    this.#tail = run.catch((): void => undefined);
    return run;
  }

  /**
   * Resolves once the event is durable. Nothing may be shown to the user as
   * saved before this settles.
   */
  append<T>(type: string, payload: T, v = 1): Promise<LogEvent<T>> {
    const run = this.#tail.then(async () => {
      const at = this.#now();
      // Wall clock when it is ahead of everything we have seen, the counter
      // when it is not. Either way strictly greater than every known event,
      // which is what lets a local append fold without re-merging.
      const pt = at.getTime();
      const hlc: Hlc =
        pt > this.#clock.l
          ? { l: pt, c: 0 }
          : { l: this.#clock.l, c: this.#clock.c + 1 };

      const event: LogEvent<T> = {
        seq: this.#seq + 1,
        device: this.#device,
        hlc,
        id: randomUUID(),
        type,
        v,
        at: at.toISOString(),
        payload,
      };

      const record = Buffer.from(encode(event as LogEvent));
      const day = dayOf(at);
      // Decided before the write, so a segment never exceeds the limit and a
      // day's records never straddle two files.
      if (
        this.#bytes > 0 &&
        (this.#bytes + record.length > this.#maxSegmentBytes ||
          day !== this.#day)
      ) {
        await this.#roll(day);
      }

      await writeAll(this.#handle, record);
      // ponytail: one fsync per event. Coalesce appends into a group commit if
      // the write rate ever makes this the bottleneck.
      await this.#handle.sync();
      this.#seq = event.seq;
      this.#clock = hlc;
      this.#bytes += record.length;
      this.#day = day;
      // The tip is what tells the next session that nobody else has been
      // writing here. It has to be recorded after the bytes are durable.
      this.#options.remember?.({
        clock: hlc,
        tip: { segment: this.#number, seq: event.seq },
      });
      return event;
    });

    // A failed append must not wedge every append after it.
    this.#tail = run.catch((): void => undefined);
    return run;
  }

  /**
   * Seals the open segment and starts the next one. Never called on an empty
   * segment: a record larger than the limit belongs in a file of its own
   * rather than in a fresh file that is already over budget, and rolling on
   * the first append of the day would leave a trail of empty files.
   */
  async #roll(day: string): Promise<void> {
    await this.#handle.close();
    this.#number += 1;
    const deviceDirectory = path.join(this.#directory, this.#device);
    this.#handle = await open(
      path.join(deviceDirectory, segmentName(this.#number)),
      'a',
    );
    // The new segment's directory entry has to be durable too, or a power cut
    // can lose the file that the next append is about to land in.
    await syncDirectory(deviceDirectory);
    this.#bytes = 0;
    this.#day = day;
  }

  /**
   * Calls `onChange` when anything in the folder moves.
   *
   * A watcher is a hint, not a guarantee — sync tools materialise files in
   * ways that do not always raise an event, and recursive watching is not
   * supported everywhere — so a coarse poll runs underneath it. Returns an
   * unsubscribe.
   *
   * ponytail: re-reads everything on any change. Track per-file offsets if a
   * busy folder shows up in battery or CPU.
   */
  watch(onChange: () => void, intervalMs = 30_000): () => void {
    let timer: NodeJS.Timeout | undefined;
    const fire = (): void => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 500);
      timer.unref();
    };

    let watcher: ReturnType<typeof watchFs> | undefined;
    try {
      watcher = watchFs(this.#directory, { recursive: true }, fire);
      // Watching for somebody else's notes is not a reason to keep a process
      // alive, and an unref'd watcher is what lets `node --test` exit.
      watcher.unref();
    } catch {
      // Linux has no recursive watch; the poll below carries it.
    }
    const poll = setInterval(onChange, intervalMs);
    poll.unref();

    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      watcher?.close();
    };
  }

  async close(): Promise<void> {
    await this.#tail.catch((): void => undefined);
    await this.#handle.close();
  }
}

/** Byte length of the log on disk, for tests and diagnostics. */
export async function logSize(file: string): Promise<number> {
  return (await stat(file)).size;
}
