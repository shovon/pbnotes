/**
 * Run with: node --test src/main/event-log.test.ts
 *
 * The only behaviour worth pinning down is crash recovery: everything else in
 * the module is a line of JSON handling, but getting the torn-tail rules wrong
 * silently destroys or misreads user history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventLog, LogCorruptError, logSize } from './event-log.ts';

async function scratch(): Promise<string> {
  return path.join(
    await mkdtemp(path.join(tmpdir(), "gnotes-log-")),
    "000001.log",
  );
}

async function collect(
  file: string,
): Promise<{ log: EventLog; seen: number[] }> {
  const seen: number[] = [];
  const log = await EventLog.open(file, (event) => seen.push(event.seq));
  return { log, seen };
}

test("replays what it appended", async () => {
  const file = await scratch();

  const first = await EventLog.open(file);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  await first.close();

  const { log, seen } = await collect(file);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(log.seq, 5);
  await log.close();
});

test("truncates a torn tail and keeps appending", async () => {
  const file = await scratch();

  const first = await EventLog.open(file);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  await first.close();

  // A crash partway through the sixth append: half a record on the end.
  const intact = await logSize(file);
  await writeFile(file, '1a2b3c4d {"seq":6,"id":"x","type":"not', {
    flag: "a",
  });

  const { log, seen } = await collect(file);
  assert.deepEqual(
    seen,
    [1, 2, 3, 4, 5],
    "the torn record must not be applied",
  );
  assert.equal(await logSize(file), intact, "the torn bytes must be gone");
  assert.equal(log.seq, 5);

  const next = await log.append("note.written", { i: 5 });
  assert.equal(
    next.seq,
    6,
    "the repaired log continues from the last good seq",
  );
  await log.close();

  const reopened = await collect(file);
  assert.deepEqual(reopened.seen, [1, 2, 3, 4, 5, 6]);
  await reopened.log.close();
});

test("refuses to load when intact records follow a damaged one", async () => {
  const file = await scratch();

  const first = await EventLog.open(file);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  await first.close();

  // Corrupt a byte in the middle, as bit-rot would.
  const lines = (await readFile(file, "utf8")).split("\n");
  lines[2] = lines[2].slice(0, 20) + "X" + lines[2].slice(21);
  await writeFile(file, lines.join("\n"));

  await assert.rejects(() => EventLog.open(file), LogCorruptError);
});

test("rejects a gap in the sequence", async () => {
  const file = await scratch();

  const first = await EventLog.open(file);
  await first.append("note.written", { i: 0 });
  await first.append("note.written", { i: 1 });
  await first.close();

  // Drop the first record; the survivor now starts at seq 2.
  const lines = (await readFile(file, "utf8")).split("\n");
  await writeFile(file, lines.slice(1).join("\n"));

  await assert.rejects(() => EventLog.open(file), LogCorruptError);
});

test("a prefix of the log is itself a valid log", async () => {
  const file = await scratch();

  const first = await EventLog.open(file);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  const cut = await logSize(file);
  for (let i = 5; i < 8; i++) await first.append("note.written", { i });
  await first.close();

  // What a copy taken mid-write would look like: the first five records plus
  // part of the sixth.
  await truncate(file, cut + 12);

  const { log, seen } = await collect(file);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  await log.close();
});
