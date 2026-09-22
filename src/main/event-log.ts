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
 * Main process only. The file format is one record per line:
 *
 *     <crc32, 8 hex chars><space><json>\n
 *
 * Text so the log stays greppable with `tail` and `jq`, with the checksum
 * outside the JSON so verification covers the exact bytes on disk rather than
 * a re-serialisation of them (which would depend on key ordering).
 */
import { open, mkdir, truncate, stat } from 'node:fs/promises';
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

/**
 * Replays the log into `apply`, repairing a tail left half-written by a crash.
 *
 * The distinction is the whole point of the pass: a bad record at the end of
 * the file is a torn write and is truncated, while a bad record with intact
 * records after it is real corruption and stops the load. Truncating the
 * second case would silently discard whatever the user did after it, and
 * skipping it would build a projection that is quietly wrong.
 */
async function recover(
  file: string,
  apply: (event: LogEvent) => void,
): Promise<number> {
  let bytes = 0;
  let seq = 0;
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
    bytes += Buffer.byteLength(line) + 1;
  }

  if (firstBad !== -1) await truncate(file, bytes);
  return seq;
}

function ignore(): void {
  // Opening a log purely to append to it is legitimate; history still has to
  // be replayed first, but the caller has nothing to fold it into.
}

export class EventLog {
  #handle: FileHandle;
  #seq: number;
  /** Serialises appends so sequence numbers and writes cannot interleave. */
  #tail: Promise<unknown> = Promise.resolve();

  private constructor(handle: FileHandle, seq: number) {
    this.#handle = handle;
    this.#seq = seq;
  }

  /**
   * Replays `file` into `apply`, then opens it for appending. Reading and
   * writing are one call on purpose: appending before recovery would write
   * past a torn tail and bake the damage in.
   */
  static async open(
    file: string,
    apply: (event: LogEvent) => void = ignore,
  ): Promise<EventLog> {
    const directory = path.dirname(file);
    await mkdir(directory, { recursive: true });

    let seq = 0;
    try {
      seq = await recover(file, apply);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    // O_APPEND: the offset is chosen at write time, so a write can never land
    // anywhere but the end.
    const handle = await open(file, 'a');
    await syncDirectory(directory);
    return new EventLog(handle, seq);
  }

  get seq(): number {
    return this.#seq;
  }

  /**
   * Resolves once the event is durable. Nothing may be shown to the user as
   * saved before this settles.
   */
  append<T>(type: string, payload: T, v = 1): Promise<LogEvent<T>> {
    const run = this.#tail.then(async () => {
      const event: LogEvent<T> = {
        seq: this.#seq + 1,
        id: randomUUID(),
        type,
        v,
        at: new Date().toISOString(),
        payload,
      };

      await writeAll(this.#handle, Buffer.from(encode(event as LogEvent)));
      // ponytail: one fsync per event. Coalesce appends into a group commit if
      // the write rate ever makes this the bottleneck.
      await this.#handle.sync();
      this.#seq = event.seq;
      return event;
    });

    // A failed append must not wedge every append after it.
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await this.#tail.catch(() => undefined);
    await this.#handle.close();
  }
}

/** Byte length of the log on disk, for tests and diagnostics. */
export async function logSize(file: string): Promise<number> {
  return (await stat(file)).size;
}
