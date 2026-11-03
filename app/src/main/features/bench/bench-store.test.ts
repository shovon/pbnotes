/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { benchFiles, createSlotStore, openBenchDatabase } from "./bench-store.ts";

// Composition root for these tests: a migrated bench file in memory for the
// table, and a scratch directory per test for the files.

function scratchDir(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-store-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "bench");
}

/** A store that must be there: the test fails, not the next line. */
function present<T>(store: T | undefined): T {
  assert.ok(store, "expected a store");
  return store;
}

test("reads back what was written, per slot", () => {
  const store = createSlotStore(openBenchDatabase(":memory:"));
  store.write("a", '["x"]');
  store.write("b", "1");
  assert.equal(store.read("a"), '["x"]');
  assert.equal(store.read("b"), "1");
});

test("nothing written reads as undefined", () => {
  const store = createSlotStore(openBenchDatabase(":memory:"));
  assert.equal(store.read("a"), undefined);
});

test("a second write replaces the first", () => {
  const store = createSlotStore(openBenchDatabase(":memory:"));
  store.write("a", "1");
  store.write("a", "2");
  assert.equal(store.read("a"), "2");
});

test("each project is a file of its own, named by its id", (t) => {
  const dir = scratchDir(t);
  const open = benchFiles(dir);
  const [a, b] = [randomUUID(), randomUUID()];
  const storeA = present(open(a, true));
  const storeB = present(open(b, true));
  storeA.write("s", '"a"');
  storeB.write("s", '"b"');
  storeA.close();
  storeB.close();

  assert.deepEqual(
    readdirSync(dir).filter((name) => name.endsWith(".db")).sort(),
    [`${a}.db`, `${b}.db`].sort(),
  );
  const again = present(open(a, false));
  assert.equal(again.read("s"), '"a"');
  again.close();
});

test("without create, a project with no file gets none and none is made", (t) => {
  const dir = scratchDir(t);
  assert.equal(benchFiles(dir)(randomUUID(), false), undefined);
  assert.throws(() => readdirSync(dir), { code: "ENOENT" });
});

test("an id that isn't a UUID never becomes a path", (t) => {
  const dir = scratchDir(t);
  const open = benchFiles(dir);
  for (const id of ["../notes", "", "x".repeat(36), `${randomUUID()}/..`]) {
    assert.throws(() => open(id, true), /Not a project id/);
  }
  assert.throws(() => readdirSync(dir), { code: "ENOENT" });
});
