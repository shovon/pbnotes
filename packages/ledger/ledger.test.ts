import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { crc32 } from "node:zlib";
import { DEFAULT_CADENCE, encode, inspect, openOrCreate, type Cadence, type Event, type LogEvent } from "./ledger.ts";

const fast: Cadence = { ...DEFAULT_CADENCE, everyMs: 20 };

const ids = (s: string[], e: Event) => [...s, e.payload as string];

async function until<T>(it: AsyncIterator<T>, ok: (t: T) => boolean): Promise<T> {
  for (;;) {
    const { value, done } = await it.next();
    assert(!done, "iterator ended");
    if (ok(value)) return value;
  }
}

const ev = (device: string, seq: number, l: number): LogEvent => ({
  seq, device, hlc: { l, c: 0 }, id: `${device}-${seq}`, type: "t", v: 1, at: new Date(l).toISOString(), payload: `${device}-${seq}`,
});
const recs = (es: LogEvent[]) => es.map(encode).join("");
const seg = (n: number) => `${String(n).padStart(16, "0")}.log`;

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), "ledger-"));
  await (await openOrCreate(dir)).close(); // writes the LEDGER marker
  return dir;
}
async function put(dir: string, device: string, n: number, body: string) {
  await mkdir(join(dir, device), { recursive: true });
  await writeFile(join(dir, device, seg(n)), body);
}

test("two machines converge, and a reply sorts after what it saw", { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "ledger-"));
  const a = await openOrCreate(dir, fast);
  const b = await openOrCreate(dir, fast);
  const ia = a.onEvent<string[]>([], (s, e) => [...s, e.type])[Symbol.asyncIterator]();
  const ib = b.onEvent<string[]>([], (s, e) => [...s, e.type])[Symbol.asyncIterator]();

  await a.writer().post(1, "question", {});
  await until(ib, (s) => s.length === 1);
  await b.writer().post(1, "answer", {});

  assert.deepEqual(await until(ia, (s) => s.length === 2), ["question", "answer"]);
  assert.deepEqual(await until(ib, (s) => s.length === 2), ["question", "answer"]);
  assert(a.status.devices.every((d) => d.state === "ok" && d.folded === 1));
  await Promise.all([a.close(), b.close()]);
});

test("records are format 1: crc32 hex, space, JSON with the old key order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ledger-"));
  const l = await openOrCreate(dir);
  const w = l.writer();
  await w.post(2, "block.created", { text: "héllo" });
  await l.close();
  assert.deepEqual(await readdir(w.directory), [seg(1)]);
  const line = await readFile(join(w.directory, seg(1)), "utf8");
  const json = line.slice(9, -1);
  assert.equal(line.slice(0, 9), crc32(json).toString(16).padStart(8, "0") + " ");
  assert.deepEqual(Object.keys(JSON.parse(json)), ["seq", "device", "hlc", "id", "type", "v", "at", "payload"]);
  assert.equal(join(dir, JSON.parse(json).device), w.directory);
});

test("one writer per ledger, and its directory waits for the first post", async () => {
  const dir = await fresh();
  const l = await openOrCreate(dir);
  const w = l.writer();
  assert.equal(l.writer(), w);
  assert.deepEqual(Object.keys(w).sort(), ["directory", "post"]);
  assert.equal(dirname(w.directory), dir);
  assert.deepEqual((await readdir(dir)).sort(), ["AGENTS.md", "LEDGER"]);
  await w.post(1, "a", {});
  await l.writer().post(1, "b", {});
  await l.close();
  assert.deepEqual((await readdir(dir)).sort(), ["AGENTS.md", "LEDGER", basename(w.directory)].sort());
  assert.equal((await readFile(join(w.directory, seg(1)), "utf8")).split("\n").length, 3);
});

test("consumers only ever see { type, v, at, payload }, frozen", { timeout: 5000 }, async () => {
  const dir = await fresh();
  await put(dir, "b", 1, recs([ev("b", 1, 1000)])); // arrives by scan
  const l = await openOrCreate(dir, fast);
  const seen: Event[] = [];
  const it = l.onEvent<number>(0, (n, e) => (seen.push(e), n + 1))[Symbol.asyncIterator]();
  const posted = await l.writer().post(1, "t", { x: 1 }); // arrives by post
  await until(it, (n) => n === 2);
  for (const e of [posted, ...seen]) {
    assert.deepEqual(Object.keys(e), ["type", "v", "at", "payload"]);
    assert(Object.isFrozen(e));
  }
  assert.throws(() => ((seen[0] as any).type = "changed"));
  await l.close();
});

test("late event rewinds via checkpoint; torn tail stalls until finished", { timeout: 5000 }, async () => {
  const dir = await fresh();
  await put(dir, "a", 1, recs(Array.from({ length: 2500 }, (_, i) => ev("a", i + 1, 2 * (i + 1)))));
  const l = await openOrCreate(dir, fast);
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  await until(it, (s) => s.length === 2500);

  const torn = encode(ev("b", 2, 3001));
  await put(dir, "b", 1, recs([ev("b", 1, 2001)]) + torn.slice(0, 20));
  const s1 = await until(it, (s) => s.length === 2501);
  assert.equal(s1[1000], "b-1");
  assert.deepEqual(s1, await until(l.onEvent<string[]>([], ids)[Symbol.asyncIterator](), () => true));
  assert.match(l.status.devices[1].detail!, /torn tail/);

  await appendFile(join(dir, "b", seg(1)), torn.slice(20));
  const s2 = await until(it, (s) => s.length === 2502);
  assert.equal(s2[1501], "b-2");
  assert.deepEqual(s2, await until(l.onEvent<string[]>([], ids)[Symbol.asyncIterator](), () => true));
  assert.deepEqual(l.status.devices[1], { device: "b", folded: 2, state: "ok" });
  await l.close();
});

test("LEDGER marker: exact bytes, strict parse, folder verdicts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ledger-"));
  await writeFile(join(dir, ".DS_Store"), "");
  assert.equal(await inspect(dir), "missing");
  await (await openOrCreate(dir)).close();
  assert.equal(
    await readFile(join(dir, "LEDGER"), "utf8"),
    "Signature: bULhVFqraHDHescwKKhK0g==\n# This folder is an append-only event ledger. Each subfolder belongs to one\n# writing session. Do not edit, rename or delete anything here by hand.\nread 1\nwrite 1\n",
  );
  assert.equal(await inspect(dir), "ledger");

  const marker = (s: string) => writeFile(join(dir, "LEDGER"), s);
  const sig = "Signature: bULhVFqraHDHescwKKhK0g==";
  await marker(`${sig}\n# old comment\nread 1\nwrite 2\n`);
  assert.equal(await inspect(dir), "newer");
  await assert.rejects(openOrCreate(dir), /newer/);
  for (const bad of [`${sig}\r\nread 1\r\nwrite 1\r\n`, `${sig}\nread 1\nwrite 1`, `${sig}\nread: 1\nwrite 1\n`, `${sig}\nread 1\nwrite 1\n\n`]) {
    await marker(bad);
    assert.equal(await inspect(dir), "not-a-ledger", JSON.stringify(bad));
  }

  const stranger = await mkdtemp(join(tmpdir(), "ledger-"));
  await writeFile(join(stranger, "notes.txt"), "hi");
  await assert.rejects(openOrCreate(stranger), /not a ledger/);
  const unmarked = await mkdtemp(join(tmpdir(), "ledger-"));
  await put(unmarked, "x", 1, "");
  await assert.rejects(openOrCreate(unmarked), /no LEDGER marker/);
});

test("dot-entries are neither read nor reported; other extras are reported", { timeout: 5000 }, async () => {
  const dir = await fresh();
  await put(dir, "a", 1, recs([ev("a", 1, 10)]));
  await put(dir, ".git", 1, recs([ev(".git", 1, 11)])); // a segment, so being read would show in the fold
  await mkdir(join(dir, ".stfolder"));
  await writeFile(join(dir, ".DS_Store"), "");
  await writeFile(join(dir, "a", ".DS_Store"), "");
  await writeFile(join(dir, "a", `.syncthing.${seg(2)}.tmp`), "");
  await writeFile(join(dir, "notes.txt"), "");

  const l = await openOrCreate(dir, fast);
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  assert.deepEqual(await until(it, () => true), ["a-1"]);
  assert.deepEqual(l.status.devices.map((d) => d.device), ["a"]);
  assert.deepEqual(l.status.ignored, [join(dir, "notes.txt")]);
  await l.close();
});

test("AGENTS.md: exact bytes, backfilled, never overwritten, never reported", { timeout: 5000 }, async () => {
  const agents = (dir: string) => readFile(join(dir, "AGENTS.md"), "utf8");
  const dir = await fresh();
  assert.equal(
    await agents(dir),
    "# Event ledger\n\nThis folder is an event ledger that several writers share. How to read it\n(the format, and why there is one folder per writer) is at\nhttps://github.com/shovon/pbnotes/blob/main/packages/ledger/multi-writer.md.\n\nDo not modify, rename or delete anything here by hand. The files are\nappend-only, and other writers share them through whatever syncs this folder.\n",
  );

  const old = await mkdtemp(join(tmpdir(), "ledger-")); // a ledger made before #63
  await writeFile(join(old, "LEDGER"), await readFile(join(dir, "LEDGER")));
  await (await openOrCreate(old)).close();
  assert.equal(await agents(old), await agents(dir), "backfilled");

  await writeFile(join(dir, "AGENTS.md"), "mine");
  const l = await openOrCreate(dir, fast);
  assert.equal(await agents(dir), "mine", "not overwritten");
  await l.refresh();
  assert.deepEqual(l.status.ignored, []);
  await l.close();

  const synced = await mkdtemp(join(tmpdir(), "ledger-")); // sync delivered it before the marker
  await writeFile(join(synced, "AGENTS.md"), "x");
  assert.equal(await inspect(synced), "missing");
  await (await openOrCreate(synced)).close();
  assert.equal(await inspect(synced), "ledger");

  const folder = await mkdtemp(join(tmpdir(), "ledger-")); // a folder of that name is a writer
  await writeFile(join(folder, "LEDGER"), await readFile(join(dir, "LEDGER")));
  await put(folder, "AGENTS.md", 1, recs([ev("AGENTS.md", 1, 10)]));
  const m = await openOrCreate(folder, fast);
  const it = m.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  assert.deepEqual(await until(it, (s) => s.length === 1), ["AGENTS.md-1"]);
  await m.close();
});

test("status: stop at gaps and damage, heal when sync fills them", { timeout: 5000 }, async () => {
  const dir = await fresh();
  await put(dir, "gap", 1, recs([ev("gap", 1, 10)]));
  await put(dir, "gap", 3, recs([ev("gap", 3, 30)]));
  await put(dir, "jump", 1, recs([ev("jump", 1, 11)]));
  await put(dir, "jump", 2, recs([ev("jump", 3, 31)]));
  await put(dir, "dmg", 1, recs([ev("dmg", 1, 12)]) + "garbage\n" + recs([ev("dmg", 2, 22)]));
  await put(dir, "dup", 1, recs([ev("dup", 1, 13), ev("dup", 1, 13), ev("dup", 2, 23)]));
  await put(dir, "z", 1, recs([ev("z", 1, Date.now() + 10 * 86_400_000)]));
  await writeFile(join(dir, "gap", "0000000000000001 (conflicted copy).log"), "");
  await mkdir(join(dir, "gap", "images"));
  await writeFile(join(dir, "gap", "images", "abc.png"), "");
  await writeFile(join(dir, "stray.log"), "");

  const l = await openOrCreate(dir, fast);
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  assert.deepEqual(await until(it, () => true), ["gap-1", "jump-1", "dmg-1", "dup-1", "dup-2", "z-1"]);
  const by = Object.fromEntries(l.status.devices.map((d) => [d.device, d]));
  assert.deepEqual(by.gap, { device: "gap", folded: 1, state: "stalled", detail: `${seg(3)} at byte 0: follows a missing one` });
  assert.deepEqual(by.jump, { device: "jump", folded: 1, state: "stalled", detail: `${seg(2)} at byte 0: jumps from seq 1 to 3` });
  assert.equal(by.dmg.state, "stalled");
  assert.match(by.dmg.detail!, /at byte \d+: intact records follow it/);
  assert.deepEqual(by.dup, { device: "dup", folded: 2, state: "ok" });
  assert.equal(by.z.state, "clockSuspect");
  assert.match(by.z.detail!, /^dated \d{4}-/);
  assert.deepEqual(l.status.ignored.map((p) => p.slice(dir.length + 1)).sort(), ["gap/0000000000000001 (conflicted copy).log", "stray.log"]);

  // Sync catches up: the missing segment arrives, and segment 1 of "jump" finishes growing.
  await put(dir, "gap", 2, recs([ev("gap", 2, 20)]));
  await appendFile(join(dir, "jump", seg(1)), recs([ev("jump", 2, 21)]));
  await until(it, (s) => s.length === 10);
  const healed = Object.fromEntries(l.status.devices.map((d) => [d.device, d]));
  assert.deepEqual(healed.gap, { device: "gap", folded: 3, state: "ok" });
  assert.deepEqual(healed.jump, { device: "jump", folded: 3, state: "ok" });
  await l.close();
});

/** Makes a directory's segment look untouched for an hour, as an ended session's does. */
const age = (dir: string, device: string, n: number) => {
  const then = new Date(Date.now() - 3_600_000);
  return utimes(join(dir, device, seg(n)), then, then);
};
const folded = (l: { status: { devices: { device: string; folded: number }[] } }, device: string) =>
  l.status.devices.find((d) => d.device === device)?.folded;
const slow = (quietEveryMs: number): Cadence => ({ everyMs: 20, quietAfterMs: 60_000, quietEveryMs });

test("a quiet directory is skipped by a scan, read by refresh, and then active again", { timeout: 5000 }, async () => {
  const dir = await fresh();
  await put(dir, "old", 1, recs([ev("old", 1, 1000)]));
  await writeFile(join(dir, "old", "stray.txt"), "");
  await age(dir, "old", 1);
  const l = await openOrCreate(dir, slow(60_000));
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  assert.deepEqual(await until(it, () => true), ["old-1"]);

  await appendFile(join(dir, "old", seg(1)), recs([ev("old", 2, 2000)]));
  await sleep(200); // ten scans or so, none of which read it
  assert.equal(folded(l, "old"), 1);
  assert.deepEqual(l.status.ignored, [join(dir, "old", "stray.txt")], "a skipped directory keeps its strays listed");

  // A new directory is read by the next scan, however quiet the others are.
  await put(dir, "new", 1, recs([ev("new", 1, 500)]));
  await age(dir, "new", 1);
  await until(it, (s) => s.includes("new-1"));
  assert.equal(folded(l, "old"), 1);

  await l.refresh();
  assert.equal(folded(l, "old"), 2);

  // It changed when last read, so it is read on every scan again.
  await appendFile(join(dir, "old", seg(1)), recs([ev("old", 3, 3000)]));
  assert.deepEqual(await until(it, (s) => s.length === 4), ["new-1", "old-1", "old-2", "old-3"]);
  await l.close();
});

test("a quiet directory is still read every quietEveryMs", { timeout: 5000 }, async () => {
  const dir = await fresh();
  await put(dir, "old", 1, recs([ev("old", 1, 1000)]));
  await age(dir, "old", 1);
  const l = await openOrCreate(dir, slow(300));
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  await until(it, () => true);
  const since = Date.now();
  await appendFile(join(dir, "old", seg(1)), recs([ev("old", 2, 2000)]));
  await until(it, (s) => s.length === 2);
  assert(Date.now() - since < 1000);
  await l.close();
});

test("a directory written recently when the ledger opens is read on every scan", { timeout: 5000 }, async () => {
  const dir = await fresh();
  await put(dir, "live", 1, recs([ev("live", 1, 1000)]));
  const l = await openOrCreate(dir, slow(60_000));
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  await until(it, () => true);
  await appendFile(join(dir, "live", seg(1)), recs([ev("live", 2, 2000)]));
  await until(it, (s) => s.length === 2);
  await l.close();
});

test("pace changes how often it scans, from the next scan", { timeout: 5000 }, async () => {
  const dir = await fresh();
  const l = await openOrCreate(dir, fast);
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  await until(it, () => true);

  l.pace({ ...fast, everyMs: 60_000 });
  await l.refresh(); // so no scan already in flight sees what comes next
  await put(dir, "b", 1, recs([ev("b", 1, 1000)]));
  await sleep(200);
  assert.equal(folded(l, "b"), undefined);

  l.pace(fast);
  assert.deepEqual(await until(it, (s) => s.length === 1), ["b-1"]);
  await l.close();
});

test("after close, refresh and pace start no scan", { timeout: 5000 }, async () => {
  const dir = await fresh();
  const l = await openOrCreate(dir, fast);
  await l.close();
  await put(dir, "b", 1, recs([ev("b", 1, 1000)]));
  await l.refresh();
  l.pace(fast);
  await sleep(100);
  assert.equal(folded(l, "b"), undefined);
});

test("a directory first seen empty is active, so its first segment is read at once", { timeout: 5000 }, async () => {
  const dir = await fresh();
  const l = await openOrCreate(dir, slow(60_000));
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  await until(it, () => true);

  // As sync clients do: the folder first, its files a moment later.
  await mkdir(join(dir, "new"));
  await sleep(100);
  await put(dir, "new", 1, recs([ev("new", 1, 1000)]));
  await age(dir, "new", 1); // a sync client may keep the writing machine's old time
  assert.deepEqual(await until(it, (s) => s.length === 1), ["new-1"]);
  await l.close();
});

test("a wall clock set back does not stop quiet directories being read", { timeout: 5000 }, async (t) => {
  const dir = await fresh();
  await put(dir, "old", 1, recs([ev("old", 1, 1000)]));
  await age(dir, "old", 1);
  const l = await openOrCreate(dir, slow(300));
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  await until(it, () => true);

  // Ten minutes back, against a directory an hour old: still quiet, and on the wall clock last read in the future.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.setTime(Date.now() - 600_000);
  await appendFile(join(dir, "old", seg(1)), recs([ev("old", 2, 2000)]));
  await until(it, (s) => s.length === 2);
  await l.close();
});

test("a cadence that is not one is refused, before anything is written", async () => {
  const parent = await mkdtemp(join(tmpdir(), "ledger-"));
  const missing = join(parent, "new");
  for (const bad of [1000, null, { everyMs: 0, quietAfterMs: 1, quietEveryMs: 1 }, { ...fast, quietEveryMs: NaN }, { everyMs: 20 }])
    await assert.rejects(openOrCreate(missing, bad as unknown as Cadence), TypeError, JSON.stringify(bad));
  assert.equal(await inspect(missing), "missing", "no marker was written");

  const l = await openOrCreate(await fresh(), fast);
  assert.throws(() => l.pace({ ...fast, everyMs: -1 }), TypeError);
  await l.close();
});

test("refreshes asked for before one starts share it", { timeout: 5000 }, async () => {
  const l = await openOrCreate(await fresh(), fast);
  const a = l.refresh();
  assert.equal(l.refresh(), a);
  await a;
  const b = l.refresh();
  assert.notEqual(b, a, "once it has run, a refresh is a new scan");
  await b;
  await l.close();
});

test("a fold says how far it reached, and holds every post at or below that", { timeout: 5000 }, async (t) => {
  const dir = await fresh();
  const l = await openOrCreate(dir, fast);
  t.after(() => l.close());
  const it = l.onFold<string[]>([], ids)[Symbol.asyncIterator]();
  assert.deepEqual((await it.next()).value, { state: [], reached: 0 });

  const posted = await l.writer().post(1, "t", "ours");
  assert.equal(l.reachOf(posted), 1);
  assert.deepEqual(await until(it, (f) => f.reached >= 1), { state: ["ours"], reached: 1 });

  await put(dir, "b", 1, recs([ev("b", 1, 1000)])); // sorts before ours
  await l.refresh();
  assert.deepEqual(await until(it, (f) => f.reached >= 2), { state: ["b-1", "ours"], reached: 2 });
  assert.equal(l.reachOf(posted), 1, "a reach does not move once given");
  assert.equal(l.reachOf({ type: "t", v: 1, at: "", payload: "ours" }), undefined, "only events our writer handed back");
});

test("a post read first by a scan still resolves with its reach", { timeout: 20000 }, async (t) => {
  const dir = await fresh();
  // Directories that sort after any of ours, so a scan that has read our record is still reading when the post ends.
  for (let k = 0; k < 40; k++) await put(dir, `zz${k}`, 1, recs([ev(`zz${k}`, 1, 1000 + k)]));
  const l = await openOrCreate(dir, fast);
  t.after(() => l.close());
  const it = l.onFold<string[]>([], ids)[Symbol.asyncIterator]();
  for (let n = 0; n < 100; n++) {
    // A full read racing the post: some of these read the record, and are not done, when the post hands it back.
    const [posted] = await Promise.all([l.writer().post(1, "t", `p${n}`), l.refresh()]);
    const reach = l.reachOf(posted);
    assert.ok(reach !== undefined, `post ${n} has no reach`);
    const fold = await until(it, (f) => f.reached >= reach);
    assert.ok(fold.state.includes(`p${n}`), `post ${n} missing at its reach`);
  }
});
