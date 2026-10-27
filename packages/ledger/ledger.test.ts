import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { crc32 } from "node:zlib";
import { encode, inspect, openOrCreate, type Event, type LogEvent } from "./ledger.ts";

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
  const a = await openOrCreate(dir, 20);
  const b = await openOrCreate(dir, 20);
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
  assert.deepEqual(await readdir(dir), ["LEDGER"]);
  await w.post(1, "a", {});
  await l.writer().post(1, "b", {});
  await l.close();
  assert.deepEqual((await readdir(dir)).sort(), ["LEDGER", basename(w.directory)].sort());
  assert.equal((await readFile(join(w.directory, seg(1)), "utf8")).split("\n").length, 3);
});

test("consumers only ever see { type, v, at, payload }, frozen", { timeout: 5000 }, async () => {
  const dir = await fresh();
  await put(dir, "b", 1, recs([ev("b", 1, 1000)])); // arrives by scan
  const l = await openOrCreate(dir, 20);
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
  const l = await openOrCreate(dir, 20);
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

  const l = await openOrCreate(dir, 20);
  const it = l.onEvent<string[]>([], ids)[Symbol.asyncIterator]();
  assert.deepEqual(await until(it, () => true), ["a-1"]);
  assert.deepEqual(l.status.devices.map((d) => d.device), ["a"]);
  assert.deepEqual(l.status.ignored, [join(dir, "notes.txt")]);
  await l.close();
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

  const l = await openOrCreate(dir, 20);
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
