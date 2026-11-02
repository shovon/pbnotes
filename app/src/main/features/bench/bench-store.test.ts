/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlotStore, openBenchDatabase } from "./bench-store.ts";

// Composition root for these tests: a fresh, migrated `bench.db` in memory.

test("reads back what was written, per project and slot", () => {
  const store = createSlotStore(openBenchDatabase(":memory:"));
  store.write("p1", "a", '["x"]');
  store.write("p2", "a", '["y"]');
  store.write("p1", "b", "1");
  assert.equal(store.read("p1", "a"), '["x"]');
  assert.equal(store.read("p2", "a"), '["y"]');
  assert.equal(store.read("p1", "b"), "1");
});

test("nothing written reads as undefined", () => {
  const store = createSlotStore(openBenchDatabase(":memory:"));
  assert.equal(store.read("p1", "a"), undefined);
});

test("a second write replaces the first", () => {
  const store = createSlotStore(openBenchDatabase(":memory:"));
  store.write("p1", "a", "1");
  store.write("p1", "a", "2");
  assert.equal(store.read("p1", "a"), "2");
});
