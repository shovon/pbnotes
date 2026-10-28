/**
 * The record format, and the rules for what a run of a segment's bytes
 * means: which records are taken, where reading stops, and why.
 *
 * Pure: no file, no clock. `ledger.ts` reads the bytes and keeps the cursor;
 * this decides what they say. Not exported from the package, which is
 * `ledger.ts`; that re-exports what is public (`encode`, `LogEvent`, `Hlc`).
 *
 * The rules are the table under "Reading foreign logs" in `multi-writer.md`,
 * and must not change without it.
 */
import { crc32 } from "node:zlib";

// On-disk format 1. Must stay byte-compatible with existing ledgers.

export type Hlc = { l: number; c: number };

export type LogEvent<T = unknown> = {
  /** 1, 2, 3… gap-free within one writer directory. Detects damage; does not order. */
  seq: number;
  /** The writer directory (one writer at a time). Named `device` for format compatibility. */
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

const hex8 = (s: string) => crc32(s).toString(16).padStart(8, "0");

/** `<crc32 of the JSON, 8 hex> <JSON>\n` */
export const encode = (e: LogEvent) => {
  const json = JSON.stringify(e);
  return `${hex8(json)} ${json}\n`;
};

/** One line, without its newline, as a record; undefined for one that is not. */
export function decode(line: string): LogEvent | undefined {
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

/** What one read of a segment's bytes found. */
export type RecordsRead = {
  /** The records taken, in order: each the `seq` after the one before. */
  accepted: LogEvent[];
  /** The `seq` of the last record taken, or the `last` read from if none was. */
  last: number;
  /**
   * The byte offset in the segment just past the last good record, taken or
   * skipped as a duplicate, where the next read resumes. Undefined when there
   * was none: the cursor stays where it was.
   */
  end?: number;
  /** The latest `hlc.l` among the records taken that are dated past `suspectAfter`. */
  suspect?: number;
  /**
   * Where in the segment reading stopped short of the end of the bytes, and
   * why. Undefined when it read them all, and the next segment is next.
   */
  stall?: { at: number; why: string };
};

/**
 * Reads the records in `buf`, which is a segment's bytes from offset `start`,
 * after the record whose `seq` is `last`.
 *
 * A left fold over the newline-ended lines, stopping at the first that says
 * stop. A record with the next `seq` is taken. One at or below `last` is a
 * duplicate delivery: skipped, but past it. One past the next `seq` stops
 * reading at it: folding past a gap builds a state that is quietly wrong. A
 * line that is not a record is remembered: a record after it stops reading at
 * it, and so does the end of the bytes, as does a last line with no newline.
 * Nothing after a stop is taken, so a stall costs the rest of this directory
 * and nothing else.
 *
 * `suspectAfter` is the time past which a record is dated too far ahead to
 * trust (the scan's wall clock plus the allowed skew). Such a record is still
 * taken; it is only reported.
 *
 * Offsets in the result are in the segment, not in `buf`. Reading the bytes
 * up to `end`, then the rest from `end` with the `last` the first read gave,
 * takes the same records as reading them all at once.
 */
export function readRecords(
  buf: Buffer,
  start: number,
  last: number,
  suspectAfter: number,
): RecordsRead {
  const accepted: LogEvent[] = [];
  let end: number | undefined;
  let suspect: number | undefined;
  const done = (stall?: { at: number; why: string }): RecordsRead =>
    stall
      ? { accepted, last, end, suspect, stall }
      : { accepted, last, end, suspect };

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
    if (firstBad >= 0) return done({ at: firstBad, why: "intact records follow it" });
    if (e.seq > last + 1) return done({ at, why: `jumps from seq ${last} to ${e.seq}` });
    if (e.seq === last + 1) {
      last = e.seq;
      accepted.push(e);
      if (e.hlc.l > suspectAfter) suspect = Math.max(suspect ?? 0, e.hlc.l);
    } // else seq <= last: duplicate delivery, skip but count its bytes
    end = start + i;
  }
  // A bad or unterminated last record: may still be syncing, or the session crashed mid-write.
  if (firstBad >= 0 || i < buf.length)
    return done({ at: firstBad >= 0 ? firstBad : start + i, why: "torn tail (may be from a crash)" });
  return done();
}
