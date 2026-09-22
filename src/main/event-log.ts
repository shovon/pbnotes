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
 * Main process only. The log is a directory of numbered segments, each one
 * record per line:
 *
 *     <crc32, 8 hex chars><space><json>\n
 *
 * Text so the log stays greppable with `tail` and `jq`, with the checksum
 * outside the JSON so verification covers the exact bytes on disk rather than
 * a re-serialisation of them (which would depend on key ordering).
 *
 * Only the newest segment is ever written to; the rest are sealed. `seq` keeps
 * counting across them, so the segments concatenated in name order are exactly
 * the log — which is why the numbers are zero-padded wide enough to sort
 * lexicographically for longer than the app will exist.
 */
import { open, mkdir, readdir, truncate, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';

export type LogEvent<T = unknown> = {
  /** Gap-free, assigned by the writer. This orders the log, not `at`. */
  seq: number;
  id: string;
  /** Domain event name, e.g. `note.written`. */
  type: string;
  /**
   * Schema version of *this event type's* payload. History cannot be
   * rewritten, so a payload shape that changes is handled by upcasting on
   * read: branch on `v` when folding, and leave what is on disk alone.
   */
  v: number;
  /** Wall clock, for display only — clocks run backwards, `seq` does not. */
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

const SEGMENT_PATTERN = new RegExp(`^\\d{${SEGMENT_DIGITS}}\\.log$`);

export function segmentName(number: number): string {
  return `${String(number).padStart(SEGMENT_DIGITS, '0')}.log`;
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

/** Returns null for anything that is not an intact record. */
function decode(line: string): LogEvent | null {
  if (line[CRC_WIDTH] !== ' ') return null;
  const json = line.slice(CRC_WIDTH + 1);
  if (checksum(json) !== line.slice(0, CRC_WIDTH)) return null;
  try {
    return JSON.parse(json) as LogEvent;
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

type Recovered = {
  /** Sequence of the last intact record, carried on into the next segment. */
  seq: number;
  /** Size of the segment once any torn tail has been cut off. */
  bytes: number;
  /** Local day of the last record, or null for an empty segment. */
  day: string | null;
};

/**
 * Replays one segment into `apply`, repairing a tail left half-written by a
 * crash.
 *
 * The distinction is the whole point of the pass: a bad record at the end of
 * the file is a torn write and is truncated, while a bad record with intact
 * records after it is real corruption and stops the load. Truncating the
 * second case would silently discard whatever the user did after it, and
 * skipping it would build a projection that is quietly wrong.
 *
 * Only the newest segment can hold a torn tail, because it is the only one
 * ever written to. A sealed segment ending in a bad record was damaged after
 * the fact, so `repairTail` is false for those and the damage is reported
 * rather than quietly cut away.
 */
async function recover(
  file: string,
  apply: (event: LogEvent) => void,
  startSeq: number,
  repairTail: boolean,
): Promise<Recovered> {
  let bytes = 0;
  let seq = startSeq;
  let day: string | null = null;
  let firstBad = -1;

  const lines = createInterface({ input: createReadStream(file) });
  for await (const line of lines) {
    const event = decode(line);

    if (firstBad !== -1) {
      if (event) {
        lines.close();
        throw new LogCorruptError(
          firstBad,
          `Log damaged at byte ${firstBad}: intact records follow it.`,
        );
      }
      continue;
    }

    if (!event) {
      firstBad = bytes;
      continue;
    }
    if (event.seq !== seq + 1) {
      lines.close();
      throw new LogCorruptError(
        bytes,
        `Log jumps from seq ${seq} to ${event.seq} at byte ${bytes}.`,
      );
    }

    apply(event);
    seq = event.seq;
    day = dayOf(event.at);
    bytes += Buffer.byteLength(line) + 1;
  }

  if (firstBad !== -1) {
    if (!repairTail) {
      throw new LogCorruptError(
        firstBad,
        `Log damaged at byte ${firstBad} of a sealed segment.`,
      );
    }
    await truncate(file, bytes);
  }
  return { seq, bytes, day };
}

function ignore(): void {
  // Opening a log purely to append to it is legitimate; history still has to
  // be replayed first, but the caller has nothing to fold it into.
}

export type LogOptions = {
  /** Defaults to `MAX_SEGMENT_BYTES`. Lowered by tests to force a roll. */
  maxSegmentBytes?: number;
  /** The clock, injectable so the daily roll can be tested without waiting. */
  now?: () => Date;
};

export class EventLog {
  #directory: string;
  #handle: FileHandle;
  #seq: number;
  /** Which segment is open for appending. */
  #number: number;
  /** Bytes in that segment, tracked rather than re-stat'd on every append. */
  #bytes: number;
  /** The local day it holds, so the next append knows the date rolled over. */
  #day: string;
  #maxSegmentBytes: number;
  #now: () => Date;
  /** Serialises appends so sequence numbers and writes cannot interleave. */
  #tail: Promise<unknown> = Promise.resolve();

  private constructor(state: {
    directory: string;
    handle: FileHandle;
    seq: number;
    number: number;
    bytes: number;
    day: string;
    maxSegmentBytes: number;
    now: () => Date;
  }) {
    this.#directory = state.directory;
    this.#handle = state.handle;
    this.#seq = state.seq;
    this.#number = state.number;
    this.#bytes = state.bytes;
    this.#day = state.day;
    this.#maxSegmentBytes = state.maxSegmentBytes;
    this.#now = state.now;
  }

  /**
   * Replays every segment in `directory` into `apply`, then opens the newest
   * for appending. Reading and writing are one call on purpose: appending
   * before recovery would write past a torn tail and bake the damage in.
   */
  static async open(
    directory: string,
    apply: (event: LogEvent) => void = ignore,
    options: LogOptions = {},
  ): Promise<EventLog> {
    const maxSegmentBytes = options.maxSegmentBytes ?? MAX_SEGMENT_BYTES;
    const now = options.now ?? (() => new Date());

    await mkdir(directory, { recursive: true });
    // Fixed-width names, so sorting them as text sorts them as numbers.
    const names = (await readdir(directory))
      .filter((name) => SEGMENT_PATTERN.test(name))
      .sort();

    let seq = 0;
    let bytes = 0;
    let day: string | null = null;
    for (const [index, name] of names.entries()) {
      const recovered = await recover(
        path.join(directory, name),
        apply,
        seq,
        index === names.length - 1,
      );
      seq = recovered.seq;
      // Only the last iteration's values survive, which is what we want: the
      // newest segment is the one about to be appended to.
      bytes = recovered.bytes;
      day = recovered.day ?? day;
    }

    const number =
      names.length > 0
        ? Number(names[names.length - 1].slice(0, SEGMENT_DIGITS))
        : 1;

    // O_APPEND: the offset is chosen at write time, so a write can never land
    // anywhere but the end.
    const handle = await open(
      path.join(directory, segmentName(number)),
      'a',
    );
    await syncDirectory(directory);

    return new EventLog({
      directory,
      handle,
      seq,
      number,
      bytes,
      day: day ?? dayOf(now()),
      maxSegmentBytes,
      now,
    });
  }

  get seq(): number {
    return this.#seq;
  }

  /** The segment currently open for appending. */
  get segment(): number {
    return this.#number;
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
    this.#handle = await open(
      path.join(this.#directory, segmentName(this.#number)),
      'a',
    );
    // The new segment's directory entry has to be durable too, or a power cut
    // can lose the file that the next append is about to land in.
    await syncDirectory(this.#directory);
    this.#bytes = 0;
    this.#day = day;
  }

  /**
   * Resolves once the event is durable. Nothing may be shown to the user as
   * saved before this settles.
   */
  append<T>(type: string, payload: T, v = 1): Promise<LogEvent<T>> {
    const run = this.#tail.then(async () => {
      const at = this.#now();
      const event: LogEvent<T> = {
        seq: this.#seq + 1,
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
      this.#bytes += record.length;
      this.#day = day;
      return event;
    });

    // A failed append must not wedge every append after it.
    this.#tail = run.catch((): void => undefined);
    return run;
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
