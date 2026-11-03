/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOpenBench } from "./bench.ts";
import type { OpenStore, Slot } from "./bench.ts";
import { benchFiles } from "./bench-store.ts";

// Composition root for these tests: the real bench files in a scratch
// directory, one slot, and which project is open as a variable a test moves.
// What is under test is that one project's bench never shows or takes
// another's, and that the right file is the one open.

const words: Slot<string[]> = {
  decode: (raw) =>
    Array.isArray(raw) && raw.every((item) => typeof item === "string")
      ? raw
      : undefined,
};

const A = randomUUID();
const B = randomUUID();

function setup(t: { after(fn: () => void): void }, firstOpen: string | undefined = A) {
  const root = mkdtempSync(path.join(tmpdir(), "bench-isolation-test-"));
  const dir = path.join(root, "bench");
  let open = firstOpen;
  // The real files, with a record of each open and close.
  const opened: string[] = [];
  const closed: string[] = [];
  const files = benchFiles(dir);
  const recording: OpenStore = (projectId, create) => {
    const store = files(projectId, create);
    if (!store) return undefined;
    opened.push(projectId);
    return {
      ...store,
      close: () => {
        closed.push(projectId);
        store.close();
      },
    };
  };
  const bench = createOpenBench(recording, new Map([["words", words]]), () => open);
  t.after(() => {
    bench.release();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    bench,
    opened,
    closed,
    files: () => readdirSync(dir).filter((name) => name.endsWith(".db")).sort(),
    switchTo: (id: string | undefined) => {
      open = id;
    },
  };
}

test("a project opened after another sees none of its values", (t) => {
  const { bench, switchTo } = setup(t);
  bench.set("words", ["a"]);
  switchTo(B);
  assert.equal(bench.get("words"), undefined);
});

test("each project gets back only its own value", (t) => {
  const { bench, switchTo } = setup(t);
  bench.set("words", ["a"]);
  switchTo(B);
  bench.set("words", ["b"]);
  assert.deepEqual(bench.get("words"), ["b"]);
  switchTo(A);
  assert.deepEqual(bench.get("words"), ["a"]);
});

test("each project's values are in its own file", (t) => {
  const { bench, switchTo, files } = setup(t);
  bench.set("words", ["a"]);
  switchTo(B);
  bench.set("words", ["b"]);
  assert.deepEqual(files(), [`${A}.db`, `${B}.db`].sort());
});

test("a call lands in the project open when it arrives", (t) => {
  const { bench, switchTo } = setup(t);
  bench.set("words", ["sent while A was open"]);
  switchTo(B);
  bench.set("words", ["sent while B was open"]);
  switchTo(A);
  assert.deepEqual(bench.get("words"), ["sent while A was open"]);
});

test("switching lets the old project's file go before the new one opens", (t) => {
  const { bench, switchTo, opened, closed } = setup(t);
  bench.set("words", ["a"]);
  switchTo(B);
  bench.set("words", ["b"]);
  assert.deepEqual(opened, [A, B]);
  assert.deepEqual(closed, [A]);
});

test("release lets the held file go, and the next call opens it again", (t) => {
  const { bench, opened, closed } = setup(t);
  bench.set("words", ["a"]);
  bench.release();
  assert.deepEqual(closed, [A]);
  assert.deepEqual(bench.get("words"), ["a"]);
  assert.deepEqual(opened, [A, A]);
});

test("a read for a project that has kept nothing makes no file", (t) => {
  const { bench, files } = setup(t);
  assert.equal(bench.get("words"), undefined);
  assert.throws(files, { code: "ENOENT" });
});

test("with nothing open, nothing is read and nothing is kept", (t) => {
  const { bench, switchTo, files } = setup(t);
  bench.set("words", ["a"]);
  switchTo(undefined);
  assert.equal(bench.get("words"), undefined);
  assert.throws(() => bench.set("words", ["orphan"]), /No project is open/);
  assert.deepEqual(files(), [`${A}.db`]);
  switchTo(A);
  assert.deepEqual(bench.get("words"), ["a"]);
});

test("a slot that is not declared is refused, open project or not", (t) => {
  const { bench, switchTo } = setup(t);
  assert.throws(() => bench.get("nope"), /no slot named "nope"/);
  switchTo(undefined);
  assert.throws(() => bench.set("nope", []), /no slot named "nope"/);
});
