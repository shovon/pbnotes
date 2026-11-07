/**
 * Run with: npm test
 *
 * The CLI as a user runs it: a child process against a real folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { openOrCreate } from "@pbnotes/ledger";
import { getPage, getPages, graphFold, today } from "@pbnotes/graph";
import type { Graph } from "@pbnotes/graph";

const run = promisify(execFile);
const CLI = join(import.meta.dirname, "cli.ts");
const append = (folder: string, text: string) => run(process.execPath, [CLI, "append", folder, text]);
const FIXTURE = join(import.meta.dirname, "..", "logseq", "fixture", "graph");
const importLogseq = (...args: string[]) => run(process.execPath, [CLI, "import-logseq", ...args]);
const scratch = () => mkdtemp(join(tmpdir(), "pbnotes-cli-"));

/** The exit code and output of a run expected to fail. */
async function failing(p: Promise<unknown>): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    await p;
  } catch (err) {
    return err as { code: number; stdout: string; stderr: string };
  }
  throw new Error("expected the command to fail");
}

async function fold(dir: string): Promise<Graph> {
  const l = await openOrCreate(dir);
  const it = l.onEvent(graphFold.initial, graphFold.reduce)[Symbol.asyncIterator]();
  const state = (await it.next()).value!;
  await l.close();
  return state;
}

/** Every file under `dir`, by path, with its bytes: to show nothing changed. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = join(entry.parentPath, entry.name);
      out[file] = (await readFile(file)).toString("base64");
    }
  }
  return out;
}

async function ledger(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pbnotes-cli-"));
  await (await openOrCreate(dir)).close();
  return dir;
}

async function journal(dir: string): Promise<string[]> {
  const l = await openOrCreate(dir);
  const it = l.onEvent(graphFold.initial, graphFold.reduce)[Symbol.asyncIterator]();
  const state = (await it.next()).value!;
  await l.close();
  const page = getPages(state).find((p) => p.title === today(new Date()));
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

test("no command, or an unknown one, exits 2 with a usage line naming both", async () => {
  for (const args of [[], ["nope"]]) {
    const { code, stderr } = await failing(run(process.execPath, [CLI, ...args]));
    assert.equal(code, 2);
    assert.match(stderr, /pbnotes append/);
    assert.match(stderr, /pbnotes import-logseq/);
  }
});

test("import-logseq into a missing folder: exit 0, a ledger holding the graph, and the report", async () => {
  const project = join(await scratch(), "new-project");
  const { stdout, stderr } = await importLogseq(FIXTURE, project);
  assert.equal(stderr, "");
  assert.match(stdout, /^Imported 5 pages, 2 journal days, 20 blocks/);
  // A file the fixture skips is named, under its heading.
  assert.match(stdout, /Skipped \(7\):[\s\S]*pages\/Old\.org  \(Org-mode file\)/);
  const state = await fold(project);
  assert.equal(getPage(state, "Book").blocks[0].text, "Read on [[Nov 4th, 2024]] and [[April 15th, 2020]]");
  assert.equal(getPage(state, "2024-11-04").blocks[0].text, "Met with Sam about [[Book]]");
});

test("import-logseq into an empty folder: exit 0", async () => {
  const project = await scratch();
  await importLogseq(FIXTURE, project);
  assert.equal(getPage(await fold(project), "Books/Fiction").blocks[0].text, "A namespaced page");
});

test("import-logseq into a ledger that holds an event: exit 1, and the ledger is unchanged", async () => {
  const project = await ledger();
  await append(project, "already here");
  const before = await snapshot(project);
  const { code, stderr } = await failing(importLogseq(FIXTURE, project));
  assert.equal(code, 1);
  assert.match(stderr, /already holds notes/);
  assert.deepEqual(await snapshot(project), before);
});

test("import-logseq twice: the second run is refused", async () => {
  const project = await scratch();
  await importLogseq(FIXTURE, project);
  assert.equal((await failing(importLogseq(FIXTURE, project))).code, 1);
});

test("import-logseq into a folder holding a file that is not a ledger: exit 1", async () => {
  const project = await scratch();
  await writeFile(join(project, "notes.txt"), "mine");
  const { code } = await failing(importLogseq(FIXTURE, project));
  assert.equal(code, 1);
  assert.deepEqual(await readdir(project), ["notes.txt"]);
});

test("import-logseq from a folder that is not a Logseq graph: exit 1, and no project made", async () => {
  const parent = await scratch();
  const graph = join(parent, "graph");
  await mkdir(graph);
  const project = join(parent, "project");
  const { code, stderr } = await failing(importLogseq(graph, project));
  assert.equal(code, 1);
  assert.match(stderr, /not a Logseq graph/);
  assert.deepEqual(await readdir(parent), ["graph"]);
});

test("import-logseq with missing arguments: exit 2 and the usage line", async () => {
  for (const args of [[], [FIXTURE]]) {
    const { code, stderr } = await failing(importLogseq(...args));
    assert.equal(code, 2);
    assert.match(stderr, /pbnotes import-logseq <logseq-graph-folder> <project-folder>/);
  }
});
