import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { encode, openOrCreate, openWriter, type Event, type LogEvent } from "./ledger.ts";

const seg = (n: number) => `${String(n).padStart(16, "0")}.log`;
const lines = async (dir: string, n: number) =>
  (await readFile(join(dir, seg(n)), "utf8")).trimEnd().split("\n").map((l) => JSON.parse(l.slice(9)) as LogEvent);

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), "ledger-"));
  await (await openOrCreate(dir)).close();
  return dir;
}

/** Runs `body` in a child process with `openWriter` and `dir` in scope; resolves with the child once it printed a line. */
function child(dir: string, body: string) {
  const src = `import { openWriter } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "ledger.ts")).href)};
const dir = ${JSON.stringify(dir)};
${body}`;
  const p = spawn(process.execPath, ["--input-type=module", "-e", src], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise<number | null>((r) => p.on("exit", (code) => r(code)));
  const line = new Promise<string>((resolve, reject) => {
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
      if (out.includes("\n")) resolve(out.split("\n")[0]);
    });
    p.on("exit", () => reject(new Error(`child exited before printing: ${out}`)));
  });
  return { p, line, exited };
}

test("resumes one directory across runs: seq carries on, segments roll by size and day", async (t) => {
  const dir = await fresh();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() - 86_400_000 });
  const a = await openWriter(dir, "k");
  await a.post(1, "t", "yesterday-1");
  await a.post(1, "t", "yesterday-2");
  await a[Symbol.asyncDispose]();
  t.mock.timers.reset();

  const b = await openWriter(dir, "k");
  assert.equal(b.directory, a.directory);
  await b.post(1, "t", "today-1");
  await b[Symbol.asyncDispose]();
  const c = await openWriter(dir, "k");
  await c.post(1, "t", "today-2");
  await c[Symbol.asyncDispose]();
  assert.deepEqual((await lines(a.directory, 1)).map((e) => e.seq), [1, 2]);
  assert.deepEqual((await lines(a.directory, 2)).map((e) => [e.seq, e.payload]), [[3, "today-1"], [4, "today-2"]]);

  // The resumed size counts toward the 16 MiB cap: the second 9 MiB record starts segment 3.
  const big = "x".repeat(9 * 1024 * 1024);
  for (const run of [1, 2]) {
    await using w = await openWriter(dir, "k");
    await w.post(1, "big", `${run}${big}`);
  }
  assert.deepEqual(await readdir(a.directory), [seg(1), seg(2), seg(3)]);
  assert.equal((await lines(a.directory, 3))[0].seq, 6);
});

test("a second writer with the same key at once gets a random directory", async () => {
  const dir = await fresh();
  const a = await openWriter(dir, "k");
  const b = await openWriter(dir, "k");
  assert.notEqual(b.directory, a.directory);
  await Promise.all([a.post(1, "t", "a"), b.post(1, "t", "b")]);
  await Promise.all([a[Symbol.asyncDispose](), b[Symbol.asyncDispose]()]);
  assert.deepEqual((await lines(a.directory, 1)).map((e) => e.seq), [1]);
  assert.deepEqual((await lines(b.directory, 1)).map((e) => e.seq), [1]);
  await using c = await openWriter(dir, "k");
  assert.equal(c.directory, a.directory);
});

test("kill -9 releases the lock; a writer that never disposes exits on its own", { timeout: 10_000 }, async () => {
  const dir = await fresh();
  const held = child(dir, `const w = await openWriter(dir, "k"); await w.post(1, "t", "child"); console.log(w.directory); setInterval(() => {}, 1e6);`);
  const keyed = await held.line;
  held.p.kill("SIGKILL");
  await held.exited;
  await using w = await openWriter(dir, "k");
  assert.equal(w.directory, keyed);
  await w.post(1, "t", "after");
  assert.deepEqual((await lines(keyed, 1)).map((e) => e.seq), [1, 2]);

  const quiet = child(dir, `const w = await openWriter(dir, "other"); await w.post(1, "t", "x"); console.log(w.directory);`);
  await quiet.line;
  assert.equal(await quiet.exited, 0);
});

test("a torn or empty tail is left alone and the writer gets a random directory", async () => {
  const dir = await fresh();
  const a = await openWriter(dir, "k");
  await a.post(1, "t", "a");
  await a[Symbol.asyncDispose]();

  const torn = encode({ ...(await lines(a.directory, 1))[0], seq: 2 }).slice(0, 20);
  await appendFile(join(a.directory, seg(1)), torn);
  const before = await readFile(join(a.directory, seg(1)));
  for (const damage of ["torn", "empty"]) {
    if (damage === "empty") {
      await writeFile(join(a.directory, seg(1)), before.subarray(0, before.length - torn.length));
      await writeFile(join(a.directory, seg(2)), "");
    }
    await using w = await openWriter(dir, "k");
    assert.notEqual(w.directory, a.directory, damage);
    await w.post(1, "t", "elsewhere");
  }
  assert.deepEqual(await readdir(a.directory), [seg(1), seg(2)]);
  assert.equal((await readFile(join(a.directory, seg(2)))).length, 0);
});

test("leaving an await using scope releases the lock, even when it throws", async () => {
  const dir = await fresh();
  let first = "";
  await assert.rejects(async () => {
    await using w = await openWriter(dir, "k");
    first = w.directory;
    throw new Error("boom");
  }, /boom/);
  await using again = await openWriter(dir, "k");
  assert.equal(again.directory, first);
});

test("dispose waits for a post in flight, and a later post rejects", async () => {
  const dir = await fresh();
  const w = await openWriter(dir, "k");
  const inFlight = w.post(1, "t", "a");
  const disposing = w[Symbol.asyncDispose]();
  await assert.rejects(w.post(1, "t", "b"), /disposed/);
  await inFlight;
  await disposing;
  await using next = await openWriter(dir, "k");
  assert.equal(next.directory, w.directory);
  await next.post(1, "t", "c");
  assert.deepEqual((await lines(w.directory, 1)).map((e) => [e.seq, e.payload]), [[1, "a"], [2, "c"]]);
});

test("the boot ID is part of the directory name", async () => {
  const dir = await fresh();
  const at = async (bootId: string) => {
    await using w = await openWriter(dir, "k", { bootId });
    return w.directory;
  };
  const one = await at("boot-1");
  assert.notEqual(await at("boot-2"), one);
  assert.equal(await at("boot-1"), one);
});

test("never creates a ledger", async () => {
  const missing = join(await mkdtemp(join(tmpdir(), "ledger-")), "nope");
  await assert.rejects(openWriter(missing, "k"), /is missing or empty/);
  await assert.rejects(access(missing));
  const empty = await mkdtemp(join(tmpdir(), "ledger-"));
  await assert.rejects(openWriter(empty, "k"), /is missing or empty/);
  assert.deepEqual(await readdir(empty), []);
  const stranger = await mkdtemp(join(tmpdir(), "ledger-"));
  await writeFile(join(stranger, "notes.txt"), "hi");
  await assert.rejects(openWriter(stranger, "k"), /not a ledger/);
  assert.deepEqual(await readdir(stranger), ["notes.txt"]);
});

test("reads no directory but its own, and puts nothing else in the folder", async () => {
  const dir = await fresh();
  await mkdir(join(dir, "sibling"));
  await chmod(join(dir, "sibling"), 0);
  try {
    await using w = await openWriter(dir, "k");
    await w.post(1, "t", "x");
    assert.deepEqual((await readdir(dir)).sort(), ["LEDGER", basename(w.directory), "sibling"].sort());
    assert.deepEqual(await readdir(w.directory), [seg(1)]);
  } finally {
    await chmod(join(dir, "sibling"), 0o755);
  }
});

test("a Ledger on the same folder folds what openWriter wrote", { timeout: 5000 }, async () => {
  const dir = await fresh();
  const l = await openOrCreate(dir, 20);
  const it = l.onEvent<unknown[]>([], (s, e: Event) => [...s, e.payload])[Symbol.asyncIterator]();
  {
    await using w = await openWriter(dir, "k");
    await w.post(1, "t", "from-cli");
  }
  for (;;) if ((await it.next()).value.includes("from-cli")) break;
  await l.close();
});

test("the lock folder is private to its user; someone else's means a random directory", { skip: process.platform === "win32" }, async () => {
  const dir = await fresh();
  const { uid } = userInfo();
  (await openWriter(dir, "k"))[Symbol.asyncDispose]();
  assert.equal((await stat(join(tmpdir(), `pbnotes-locks-${uid}`))).mode & 0o777, 0o700);

  // We create pbnotes-locks-<uid+1>, so it isn't owned by uid+1.
  const other = join(tmpdir(), `pbnotes-locks-${uid + 1}`);
  try {
    const at = async () => {
      await using w = await openWriter(dir, "k", { uid: uid + 1 });
      return w.directory;
    };
    assert.notEqual(await at(), await at());
  } finally {
    await rm(other, { recursive: true, force: true });
  }
});
