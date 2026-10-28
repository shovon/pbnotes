/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, readRecords } from "./records.ts";
import type { LogEvent } from "./records.ts";

// Composition root for these tests: records built by hand, and a fixed time
// past which a record is dated too far ahead.

const AHEAD = 10_000;

const rec = (seq: number, l = 1_000, payload: unknown = `r${seq}`): LogEvent => ({
  seq,
  device: "w",
  hlc: { l, c: 0 },
  id: `w-${seq}`,
  type: "t",
  v: 1,
  at: new Date(l).toISOString(),
  payload,
});
const bytes = (...lines: string[]) => Buffer.from(lines.join(""));
const lines = (...es: LogEvent[]) => es.map(encode);
const len = (s: string) => Buffer.byteLength(s);
const seqs = (es: LogEvent[]) => es.map((e) => e.seq);

test("a clean run is taken whole, and the next read starts past it", () => {
  const all = lines(rec(1), rec(2), rec(3));
  const read = readRecords(bytes(...all), 0, 0, AHEAD);
  assert.deepEqual(seqs(read.accepted), [1, 2, 3]);
  assert.equal(read.last, 3);
  assert.equal(read.end, len(all.join("")));
  assert.equal(read.stall, undefined);
});

test("nothing to read is nothing taken, no stall, and the cursor stays", () => {
  assert.deepEqual(readRecords(Buffer.alloc(0), 120, 7, AHEAD), {
    accepted: [],
    last: 7,
    end: undefined,
    suspect: undefined,
  });
});

test("a duplicate delivery is skipped, but read past", () => {
  const all = lines(rec(1), rec(2), rec(2), rec(3));
  const read = readRecords(bytes(...all), 0, 1, AHEAD);
  assert.deepEqual(seqs(read.accepted), [2, 3]);
  assert.equal(read.end, len(all.join("")));
  // Only duplicates: nothing taken, and still past them.
  const dups = readRecords(bytes(...lines(rec(1), rec(2))), 0, 2, AHEAD);
  assert.deepEqual(dups.accepted, []);
  assert.equal(dups.last, 2);
  assert.equal(dups.end, len(lines(rec(1), rec(2)).join("")));
});

test("a seq that jumps stops reading at it", () => {
  const [one, three] = lines(rec(1), rec(3));
  const read = readRecords(bytes(one, three), 0, 0, AHEAD);
  assert.deepEqual(seqs(read.accepted), [1]);
  assert.equal(read.end, len(one));
  assert.deepEqual(read.stall, { at: len(one), why: "jumps from seq 1 to 3" });
  // From the first record on: nothing taken, and the cursor stays.
  assert.deepEqual(readRecords(bytes(three), 0, 0, AHEAD), {
    accepted: [],
    last: 0,
    end: undefined,
    suspect: undefined,
    stall: { at: 0, why: "jumps from seq 0 to 3" },
  });
});

test("a bad record with intact records after it stops reading at the bad one", () => {
  const [one, two] = lines(rec(1), rec(2));
  const read = readRecords(bytes(one, "not a record\n", two), 0, 0, AHEAD);
  assert.deepEqual(seqs(read.accepted), [1]);
  assert.equal(read.end, len(one));
  assert.deepEqual(read.stall, { at: len(one), why: "intact records follow it" });
});

test("a record whose checksum does not match is a bad record", () => {
  const [one, two, three] = lines(rec(1), rec(2), rec(3));
  const flipped = two.replace('"r2"', '"r9"');
  const read = readRecords(bytes(one, flipped, three), 0, 0, AHEAD);
  assert.deepEqual(seqs(read.accepted), [1]);
  assert.deepEqual(read.stall, { at: len(one), why: "intact records follow it" });
});

test("a bad or unterminated last record is a torn tail, at its start", () => {
  const [one, two] = lines(rec(1), rec(2));
  const torn = { at: len(one), why: "torn tail (may be from a crash)" };
  // Bad, with its newline.
  assert.deepEqual(readRecords(bytes(one, "garbage\n"), 0, 0, AHEAD).stall, torn);
  // Good so far, but the newline has not arrived.
  const cut = readRecords(bytes(one, two.slice(0, -1)), 0, 0, AHEAD);
  assert.deepEqual(seqs(cut.accepted), [1]);
  assert.equal(cut.end, len(one));
  assert.deepEqual(cut.stall, torn);
  // Several bad lines at the end: the first of them.
  assert.deepEqual(readRecords(bytes(one, "x\n", "y\n"), 0, 0, AHEAD).stall, torn);
});

test("offsets are in the segment, from where the read started", () => {
  const [four, five] = lines(rec(4), rec(5));
  const start = 1234;
  const read = readRecords(bytes(four, "bad\n", five), start, 3, AHEAD);
  assert.equal(read.end, start + len(four));
  assert.deepEqual(read.stall, { at: start + len(four), why: "intact records follow it" });
});

test("a record dated too far ahead is taken, and the latest such is reported", () => {
  const read = readRecords(
    bytes(...lines(rec(1, AHEAD + 5), rec(2, 500), rec(3, AHEAD + 9), rec(4, AHEAD))),
    0,
    0,
    AHEAD,
  );
  assert.deepEqual(seqs(read.accepted), [1, 2, 3, 4]);
  assert.equal(read.suspect, AHEAD + 9);
  // A duplicate is not taken, so it is not reported either.
  assert.equal(readRecords(bytes(...lines(rec(1, AHEAD + 5))), 0, 1, AHEAD).suspect, undefined);
});

/**
 * Records with text that is more than one byte a character, so a cut lands in
 * the middle of one as well as between them.
 */
const run = lines(
  rec(1, 1_000, "plain"),
  rec(2, 1_001, "café ☕ — naïve"),
  rec(3, 1_002, { nested: ["日本語", "🙂🙃"] }),
  rec(4, 1_003, ""),
  rec(5, 1_004, "end"),
);
const whole = bytes(...run);
/** The byte offset at which each record's line ends, newline included. */
const ends = run.map((_, k) => len(run.slice(0, k + 1).join("")));

test("cut at any byte, a run is taken up to the last whole record and stops at the cut", () => {
  for (let cut = 0; cut <= whole.length; cut++) {
    const read = readRecords(whole.subarray(0, cut), 0, 0, AHEAD);
    const whole_ = ends.filter((e) => e <= cut);
    const upTo = whole_.at(-1);
    assert.deepEqual(seqs(read.accepted), whole_.map((_, k) => k + 1), `cut at ${cut}`);
    assert.equal(read.end, upTo, `cut at ${cut}`);
    // Never a record past the cut, and a stall exactly when a record is cut.
    assert.ok((read.end ?? 0) <= cut, `cut at ${cut}`);
    assert.deepEqual(
      read.stall,
      cut === (upTo ?? 0) ? undefined : { at: upTo ?? 0, why: "torn tail (may be from a crash)" },
      `cut at ${cut}`,
    );
  }
});

test("read up to a cut and then on from where it stopped, a run is taken once, whole", () => {
  for (let cut = 0; cut <= whole.length; cut++) {
    const first = readRecords(whole.subarray(0, cut), 0, 0, AHEAD);
    const from = first.end ?? 0;
    const rest = readRecords(whole.subarray(from), from, first.last, AHEAD);
    assert.deepEqual(seqs([...first.accepted, ...rest.accepted]), [1, 2, 3, 4, 5], `cut at ${cut}`);
    // Where the cursor ends up: past the run, whichever read got it there.
    assert.equal(rest.end ?? first.end, whole.length, `cut at ${cut}`);
    assert.equal(rest.stall, undefined, `cut at ${cut}`);
  }
});

test("a bad line anywhere in a run takes what is before it and nothing after", () => {
  for (let k = 0; k <= run.length; k++) {
    const read = readRecords(bytes(...run.slice(0, k), "bad\n", ...run.slice(k)), 0, 0, AHEAD);
    const before = k === 0 ? 0 : ends[k - 1];
    assert.deepEqual(seqs(read.accepted), run.slice(0, k).map((_, j) => j + 1), `bad at ${k}`);
    assert.deepEqual(read.stall, {
      at: before,
      why: k === run.length ? "torn tail (may be from a crash)" : "intact records follow it",
    });
  }
});
