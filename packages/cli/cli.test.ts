/**
 * Run with: npm test
 *
 * The CLI as a user runs it: a child process against a real folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { openOrCreate } from "@pbnotes/ledger";
import { getPages, pagesFold, today } from "@pbnotes/pages";

const run = promisify(execFile);
const CLI = join(import.meta.dirname, "cli.ts");
const append = (folder: string, text: string) => run(process.execPath, [CLI, "append", folder, text]);

async function ledger(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pbnotes-cli-"));
  await (await openOrCreate(dir)).close();
  return dir;
}

async function journal(dir: string): Promise<string[]> {
  const l = await openOrCreate(dir);
  const it = l.onEvent(pagesFold.initial, pagesFold.reduce)[Symbol.asyncIterator]();
  const state = (await it.next()).value!;
  await l.close();
  const page = getPages({ state, dispatch: async () => {} }).find((p) => p.title === today(new Date()));
  return page?.blocks.map((b) => b.text) ?? [];
}

const writers = async (dir: string) => (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory());

test("two runs in one boot land at the end of today, in one writer directory", async () => {
  const dir = await ledger();
  const first = await append(dir, "one");
  await append(dir, "two");
  assert.equal(first.stdout + first.stderr, "");
  assert.deepEqual(await journal(dir), ["one", "two"]);
  assert.equal((await writers(dir)).length, 1);
});

test("two runs at once both land", async () => {
  const dir = await ledger();
  await Promise.all([append(dir, "a"), append(dir, "b")]);
  assert.deepEqual((await journal(dir)).sort(), ["a", "b"]);
});

test("text from stdin", async () => {
  const dir = await ledger();
  const child = execFile(process.execPath, [CLI, "append", dir]);
  child.stdin!.end("piped\n");
  await new Promise((resolve) => child.on("exit", resolve));
  assert.deepEqual(await journal(dir), ["piped"]);
});

test("a folder that is not a ledger exits non-zero and creates nothing", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pbnotes-cli-"));
  const missing = join(parent, "typo");
  await assert.rejects(append(missing, "x"), (err: { code: number }) => err.code === 1);
  assert.deepEqual(await readdir(parent), []);
});
