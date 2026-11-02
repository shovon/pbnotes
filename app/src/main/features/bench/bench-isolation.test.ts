/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { benchOfOpenProject, createBench } from "./bench.ts";
import type { Slot } from "./bench.ts";
import { createSlotStore, openBenchDatabase } from "./bench-store.ts";

// Composition root for these tests: the real `bench.db` schema in memory, one
// slot, and which project is open as a variable a test moves. What is under
// test is that one project's bench never shows or takes another's.

const words: Slot<string[]> = {
  decode: (raw) =>
    Array.isArray(raw) && raw.every((item) => typeof item === "string")
      ? raw
      : undefined,
};

function setup(firstOpen: string | undefined = "A") {
  let open = firstOpen;
  const bench = benchOfOpenProject(
    createBench(
      createSlotStore(openBenchDatabase(":memory:")),
      new Map([["words", words]]),
    ),
    () => open,
  );
  return {
    bench,
    switchTo: (id: string | undefined) => {
      open = id;
    },
  };
}

test("a project opened after another sees none of its values", () => {
  const { bench, switchTo } = setup("A");
  bench.set("words", ["a"]);
  switchTo("B");
  assert.equal(bench.get("words"), undefined);
});

test("each project gets back only its own value", () => {
  const { bench, switchTo } = setup("A");
  bench.set("words", ["a"]);
  switchTo("B");
  bench.set("words", ["b"]);
  assert.deepEqual(bench.get("words"), ["b"]);
  switchTo("A");
  assert.deepEqual(bench.get("words"), ["a"]);
});

test("a call lands in the project open when it arrives", () => {
  const { bench, switchTo } = setup("A");
  bench.set("words", ["sent while A was open"]);
  switchTo("B");
  bench.set("words", ["sent while B was open"]);
  switchTo("A");
  assert.deepEqual(bench.get("words"), ["sent while A was open"]);
});

test("with nothing open, nothing is read and nothing is kept", () => {
  const { bench, switchTo } = setup("A");
  bench.set("words", ["a"]);
  switchTo(undefined);
  assert.equal(bench.get("words"), undefined);
  assert.throws(() => bench.set("words", ["orphan"]), /No project is open/);
  switchTo("A");
  assert.deepEqual(bench.get("words"), ["a"]);
});
