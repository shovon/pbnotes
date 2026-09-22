/**
 * Run with: node --test src/main/event-log.test.ts
 *
 * Two behaviours are worth pinning down. Crash recovery, because getting the
 * torn-tail rules wrong silently destroys or misreads user history. And
 * segment rollover, because `seq` has to keep counting across files — a log
 * that restarts its numbering in each segment is a log that cannot be read
 * back as one sequence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EventLog,
  LogCorruptError,
  logSize,
  segmentName,
} from './event-log.ts';

/** A fresh, empty log directory. */
async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gnotes-log-"));
}

/** The nth segment inside a log directory, for reading or corrupting. */
function segment(directory: string, number = 1): string {
  return path.join(directory, segmentName(number));
}

async function segments(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort();
}

async function collect(
  directory: string,
): Promise<{ log: EventLog; seen: number[] }> {
  const seen: number[] = [];
  const log = await EventLog.open(directory, (event) => seen.push(event.seq));
  return { log, seen };
}

test("replays what it appended", async () => {
  const dir = await scratch();

  const first = await EventLog.open(dir);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  await first.close();

  assert.deepEqual(await segments(dir), ["0000000000000001.log"]);

  const { log, seen } = await collect(dir);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(log.seq, 5);
  await log.close();
});

test("truncates a torn tail and keeps appending", async () => {
  const dir = await scratch();

  const first = await EventLog.open(dir);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  await first.close();

  // A crash partway through the sixth append: half a record on the end.
  const intact = await logSize(segment(dir));
  await writeFile(segment(dir), '1a2b3c4d {"seq":6,"id":"x","type":"not', {
    flag: "a",
  });

  const { log, seen } = await collect(dir);
  assert.deepEqual(
    seen,
    [1, 2, 3, 4, 5],
    "the torn record must not be applied",
  );
  assert.equal(
    await logSize(segment(dir)),
    intact,
    "the torn bytes must be gone",
  );
  assert.equal(log.seq, 5);

  const next = await log.append("note.written", { i: 5 });
  assert.equal(
    next.seq,
    6,
    "the repaired log continues from the last good seq",
  );
  await log.close();

  const reopened = await collect(dir);
  assert.deepEqual(reopened.seen, [1, 2, 3, 4, 5, 6]);
  await reopened.log.close();
});

test("refuses to load when intact records follow a damaged one", async () => {
  const dir = await scratch();

  const first = await EventLog.open(dir);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  await first.close();

  // Corrupt a byte in the middle, as bit-rot would.
  const lines = (await readFile(segment(dir), "utf8")).split("\n");
  lines[2] = lines[2].slice(0, 20) + "X" + lines[2].slice(21);
  await writeFile(segment(dir), lines.join("\n"));

  await assert.rejects(() => EventLog.open(dir), LogCorruptError);
});

test("rejects a gap in the sequence", async () => {
  const dir = await scratch();

  const first = await EventLog.open(dir);
  await first.append("note.written", { i: 0 });
  await first.append("note.written", { i: 1 });
  await first.close();

  // Drop the first record; the survivor now starts at seq 2.
  const lines = (await readFile(segment(dir), "utf8")).split("\n");
  await writeFile(segment(dir), lines.slice(1).join("\n"));

  await assert.rejects(() => EventLog.open(dir), LogCorruptError);
});

test("a prefix of the log is itself a valid log", async () => {
  const dir = await scratch();

  const first = await EventLog.open(dir);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  const cut = await logSize(segment(dir));
  for (let i = 5; i < 8; i++) await first.append("note.written", { i });
  await first.close();

  // What a copy taken mid-write would look like: the first five records plus
  // part of the sixth.
  await truncate(segment(dir), cut + 12);

  const { log, seen } = await collect(dir);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  await log.close();
});

test("rolls to a new segment at the size limit", async () => {
  const dir = await scratch();

  // Small enough that a couple of records fill it; the rule is the same at
  // 16 MiB.
  const log = await EventLog.open(dir, undefined, { maxSegmentBytes: 400 });
  for (let i = 0; i < 6; i++) await log.append("note.written", { i });
  await log.close();

  const names = await segments(dir);
  assert.ok(names.length > 1, `expected a roll, got ${names.join(", ")}`);
  for (const name of names) {
    assert.ok(
      (await logSize(path.join(dir, name))) <= 400,
      `${name} is over the limit`,
    );
  }

  // The whole point of rolling: it is still one sequence.
  const { log: reopened, seen } = await collect(dir);
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6]);
  assert.equal(reopened.seq, 6);
  await reopened.close();
});

test("rolls to a new segment when the local day changes", async () => {
  const dir = await scratch();

  let clock = new Date("2026-09-21T10:00:00");
  const log = await EventLog.open(dir, undefined, { now: () => clock });

  await log.append("note.written", { i: 0 });
  await log.append("note.written", { i: 1 });
  assert.equal(log.segment, 1);

  // Same moment in UTC terms for much of the world, a new day locally.
  clock = new Date("2026-09-22T09:00:00");
  await log.append("note.written", { i: 2 });
  assert.equal(log.segment, 2, "a new day starts a new segment");

  await log.append("note.written", { i: 3 });
  assert.equal(log.segment, 2, "but only once");
  await log.close();

  assert.deepEqual(await segments(dir), [
    "0000000000000001.log",
    "0000000000000002.log",
  ]);

  const { log: reopened, seen } = await collect(dir);
  assert.deepEqual(seen, [1, 2, 3, 4]);
  await reopened.close();

  // Reopened on the same day as the last record, so it keeps writing there.
  const same = await EventLog.open(dir, undefined, { now: () => clock });
  await same.append("note.written", { i: 4 });
  assert.equal(same.segment, 2);
  await same.close();
});
