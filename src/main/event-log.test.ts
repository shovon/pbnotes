/**
 * Run with: node --test src/main/event-log.test.ts
 *
 * Three behaviours are worth pinning down. Crash recovery, because getting the
 * torn-tail rules wrong silently destroys or misreads user history. Segment
 * rollover, because `seq` has to keep counting across files — a log that
 * restarts its numbering in each segment is a log that cannot be read back as
 * one sequence. And everything the folder does once it is shared with a sync
 * tool, where a half-arrived file is an ordinary Tuesday rather than damage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EventLog,
  LogCorruptError,
  compare,
  logSize,
  segmentName,
} from './event-log.ts';
import type { LogEvent, LogOptions } from './event-log.ts';

/**
 * The machine under test. Pinned because a device writes only inside its own
 * directory, so the id decides where the bytes land; in the app it comes from
 * `notes.db` and is just as stable.
 */
const DEVICE = "device-a";

/** A fresh, empty log directory. */
async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gnotes-log-"));
}

function openLog(
  directory: string,
  apply?: (event: LogEvent) => void,
  options: LogOptions = {},
): Promise<EventLog> {
  return EventLog.open(directory, apply, { device: DEVICE, ...options });
}

/** One device's directory inside a log folder. */
function deviceDirectory(directory: string, device = DEVICE): string {
  return path.join(directory, device);
}

/** The nth segment of a device, for reading or corrupting. */
function segment(directory: string, number = 1, device = DEVICE): string {
  return path.join(deviceDirectory(directory, device), segmentName(number));
}

async function segments(directory: string, device = DEVICE): Promise<string[]> {
  return (await readdir(deviceDirectory(directory, device))).sort();
}

async function collect(
  directory: string,
  options: LogOptions = {},
): Promise<{ log: EventLog; seen: number[] }> {
  const seen: number[] = [];
  const log = await openLog(directory, (event) => seen.push(event.seq), options);
  return { log, seen };
}

/** Everything a fold would see, in merged order. */
async function folded(
  directory: string,
  options: LogOptions = {},
): Promise<LogEvent[]> {
  const events: LogEvent[] = [];
  const log = await openLog(directory, (event) => events.push(event), options);
  await log.close();
  return events;
}

test("replays what it appended", async () => {
  const dir = await scratch();

  const first = await openLog(dir);
  assert.deepEqual(
    first.status.devices,
    [{ device: DEVICE, folded: 0, state: "ok" }],
    "an empty folder is not a folder we failed to read",
  );
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

  const first = await openLog(dir);
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

  const first = await openLog(dir);
  for (let i = 0; i < 5; i++) await first.append("note.written", { i });
  await first.close();

  // Corrupt a byte in the middle, as bit-rot would.
  const lines = (await readFile(segment(dir), "utf8")).split("\n");
  lines[2] = lines[2].slice(0, 20) + "X" + lines[2].slice(21);
  await writeFile(segment(dir), lines.join("\n"));

  await assert.rejects(() => openLog(dir), LogCorruptError);
});

test("rejects a gap in the sequence", async () => {
  const dir = await scratch();

  const first = await openLog(dir);
  await first.append("note.written", { i: 0 });
  await first.append("note.written", { i: 1 });
  await first.close();

  // Drop the first record; the survivor now starts at seq 2.
  const lines = (await readFile(segment(dir), "utf8")).split("\n");
  await writeFile(segment(dir), lines.slice(1).join("\n"));

  await assert.rejects(() => openLog(dir), LogCorruptError);
});

test("a prefix of the log is itself a valid log", async () => {
  const dir = await scratch();

  const first = await openLog(dir);
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
  const log = await openLog(dir, undefined, { maxSegmentBytes: 400 });
  for (let i = 0; i < 6; i++) await log.append("note.written", { i });
  await log.close();

  const names = await segments(dir);
  assert.ok(names.length > 1, `expected a roll, got ${names.join(", ")}`);
  for (const name of names) {
    assert.ok(
      (await logSize(path.join(deviceDirectory(dir), name))) <= 400,
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
  const log = await openLog(dir, undefined, { now: () => clock });

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
  const same = await openLog(dir, undefined, { now: () => clock });
  await same.append("note.written", { i: 4 });
  assert.equal(same.segment, 2);
  await same.close();
});

test("survives a crash that cut off only the final newline", async () => {
  const dir = await scratch();

  const first = await openLog(dir);
  for (let i = 0; i < 2; i++) await first.append("note.written", { i });
  await first.close();

  // The record landed; the newline after it did not.
  await truncate(segment(dir), (await logSize(segment(dir))) - 1);

  const { log, seen } = await collect(dir);
  assert.deepEqual(seen, [1, 2], "the whole record was written, so keep it");

  await log.append("note.written", { i: 2 });
  await log.close();

  const reopened = await collect(dir);
  assert.deepEqual(
    reopened.seen,
    [1, 2, 3],
    "the appended record must not have landed on the previous line",
  );
  await reopened.log.close();
});

// ---------------------------------------------------------------------------
// A shared folder. Everything below is about files this device did not write.
// ---------------------------------------------------------------------------

/** Another machine, writing into the same folder as machines do. */
async function otherDevice(
  directory: string,
  device: string,
  count: number,
  options: LogOptions = {},
): Promise<void> {
  const log = await EventLog.open(directory, undefined, { device, ...options });
  for (let i = 0; i < count; i++) await log.append("note.written", { device, i });
  await log.close();
}

test("a foreign torn tail is folded around, never truncated", async () => {
  const dir = await scratch();
  await otherDevice(dir, "device-b", 3);
  const whole = await readFile(segment(dir, 1, "device-b"));

  // Half a record on the end, exactly as a file still being synced looks.
  await writeFile(segment(dir, 1, "device-b"), whole.subarray(0, whole.length - 30));
  const torn = await logSize(segment(dir, 1, "device-b"));

  const log = await openLog(dir);
  assert.equal(
    await logSize(segment(dir, 1, "device-b")),
    torn,
    "a file we do not own must not be repaired",
  );
  const stalled = log.status.devices.find((it) => it.device === "device-b");
  assert.equal(stalled?.state, "stalled");
  assert.equal(stalled?.folded, 2, "everything intact still folds");
  await log.close();

  // The rest of the file arrives.
  await writeFile(segment(dir, 1, "device-b"), whole);
  const healed = await openLog(dir);
  assert.equal(
    healed.status.devices.find((it) => it.device === "device-b")?.state,
    "ok",
    "a stall is a wait, not a verdict",
  );
  assert.equal(
    healed.status.devices.find((it) => it.device === "device-b")?.folded,
    3,
  );
  await healed.close();
});

test("one damaged device does not stop the folder opening", async () => {
  const dir = await scratch();
  await otherDevice(dir, "device-b", 4);
  await otherDevice(dir, "device-c", 2);

  // Bit-rot in the middle of device-b: intact records follow it, so this is
  // damage rather than a tail still arriving.
  const lines = (await readFile(segment(dir, 1, "device-b"), "utf8")).split("\n");
  lines[1] = lines[1].slice(0, 20) + "X" + lines[1].slice(21);
  await writeFile(segment(dir, 1, "device-b"), lines.join("\n"));

  const log = await openLog(dir);
  assert.equal(
    log.status.devices.find((it) => it.device === "device-b")?.state,
    "stalled",
  );
  assert.equal(
    log.status.devices.find((it) => it.device === "device-c")?.folded,
    2,
    "another device's damage costs this one nothing",
  );
  await log.append("note.written", { mine: true });
  await log.close();
});

test("files that are not a device's segments are reported, not swallowed", async () => {
  const dir = await scratch();
  await otherDevice(dir, "device-b", 1);
  // The old single-writer layout, and what Dropbox names a divergence.
  await writeFile(path.join(dir, segmentName(1)), "legacy\n");
  await writeFile(
    path.join(dir, "device-b", "0000000000000001 (conflicted copy).log"),
    "someone else\n",
  );

  const log = await openLog(dir);
  const names = log.status.ignored.map((it) => path.basename(it)).sort();
  assert.deepEqual(names, [
    "0000000000000001 (conflicted copy).log",
    "0000000000000001.log",
  ]);
  await log.close();
});

test("a segment delivered twice folds once", async () => {
  const dir = await scratch();
  await otherDevice(dir, "device-b", 3);

  // A restored file, a folder copied in: the same records, again.
  const whole = await readFile(segment(dir, 1, "device-b"), "utf8");
  await writeFile(segment(dir, 1, "device-b"), whole + whole);

  const events = await folded(dir);
  assert.deepEqual(
    events.map((it) => it.seq),
    [1, 2, 3],
  );
});

test("a device that has never seen the folder still sorts after it", async () => {
  const dir = await scratch();
  const away = await scratch();

  // A month of history on one machine, still downloading — so the new machine
  // folds an empty folder and writes anyway.
  await otherDevice(away, "device-b", 3, {
    now: () => new Date("2026-08-01T09:00:00Z"),
  });

  const fresh = await openLog(dir, undefined, {
    now: () => new Date("2026-09-01T09:00:00Z"),
  });
  await fresh.append("note.written", { late: true });
  await fresh.close();

  // The history lands.
  await cp(path.join(away, "device-b"), path.join(dir, "device-b"), {
    recursive: true,
  });

  const events = await folded(dir);
  assert.deepEqual(
    events.map((it) => it.device),
    ["device-b", "device-b", "device-b", DEVICE],
    "a month of history must not sort after a note written today",
  );
});

test("a clock set years ahead is folded but does not move ours", async () => {
  const dir = await scratch();
  await otherDevice(dir, "device-b", 2, {
    now: () => new Date("2031-01-01T00:00:00Z"),
  });

  const now = new Date("2026-09-22T12:00:00Z");
  const log = await openLog(dir, undefined, { now: () => now });
  assert.equal(
    log.status.devices.find((it) => it.device === "device-b")?.state,
    "clockSuspect",
  );

  const mine = await log.append("note.written", { sane: true });
  assert.equal(
    mine.hlc.l,
    now.getTime(),
    "our clock must not have been dragged into 2031",
  );
  await log.close();

  // The bound cannot reorder somebody's bogus timestamp — an event claiming
  // 2031 sorts last until 2031. What it prevents is the poison spreading: a
  // machine joining afterwards, with a correct clock and nothing remembered,
  // must still sort after the notes that were really written before it.
  const later = await EventLog.open(dir, undefined, {
    device: "device-c",
    now: () => new Date("2026-09-22T13:00:00Z"),
  });
  const theirs = await later.append("note.written", { after: true });
  await later.close();

  assert.equal(compare(theirs, mine) > 0, true);
  const events = await folded(dir);
  assert.deepEqual(
    events.filter((it) => it.device !== "device-b").map((it) => it.device),
    [DEVICE, "device-c"],
  );
});

test("the clock never goes backwards", async () => {
  const dir = await scratch();
  // A remote event from an hour ahead — inside the skew bound, so it counts.
  const ahead = new Date("2026-09-22T13:00:00Z");
  await otherDevice(dir, "device-b", 1, { now: () => ahead });

  const behind = new Date("2026-09-22T12:00:00Z");
  const log = await openLog(dir, undefined, { now: () => behind });
  const first = await log.append("note.written", { i: 0 });
  assert.equal(first.hlc.l, ahead.getTime(), "floored by what we have seen");
  assert.equal(first.hlc.c, 1, "and the counter breaks the tie");

  const second = await log.append("note.written", { i: 1 });
  assert.equal(compare(second, first) > 0, true);
  await log.close();
});

test("a remembered clock survives a folder that loses files", async () => {
  const dir = await scratch();
  const log = await openLog(dir, undefined, {
    now: () => new Date("2026-09-22T12:00:00Z"),
  });
  const last = await log.append("note.written", { i: 0 });
  await log.close();

  // Selective sync drops everything; our own clock is all that is left.
  await rm(path.join(dir, DEVICE), { recursive: true });

  const reopened = await openLog(dir, undefined, {
    memory: { clock: last.hlc, tip: null },
    now: () => new Date("2026-09-22T11:00:00Z"),
  });
  const next = await reopened.append("note.written", { i: 1 });
  assert.equal(compare(next, last) > 0, true, "an emptied folder cannot rewind us");
  await reopened.close();
});

test("a log running past our recorded tip mints a new device id", async () => {
  const dir = await scratch();
  const log = await openLog(dir);
  for (let i = 0; i < 3; i++) await log.append("note.written", { i });
  await log.close();

  // What a cloned machine sees: records in our own file that we did not write.
  let minted = "";
  const rotated = await openLog(dir, undefined, {
    memory: { clock: { l: 0, c: 0 }, tip: { segment: 1, seq: 1 } },
    rotate: () => (minted = "device-a-reborn"),
  });

  assert.equal(rotated.device, minted);
  assert.equal(rotated.seq, 0, "a new identity has written nothing yet");
  await rotated.append("note.written", { fresh: true });
  await rotated.close();

  // Nothing was lost: the old directory is simply somebody else's now.
  const events = await folded(dir, { device: minted });
  assert.deepEqual(
    events.map((it) => it.device),
    [DEVICE, DEVICE, DEVICE, minted],
  );
});
