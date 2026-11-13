/**
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { add, empty, from, has, remove, values } from "./set.ts";

const sorted = (set: Parameters<typeof values>[0]) => [...values(set)].sort();

test("holds what was added, once, and nothing that was removed", () => {
  let set = empty();
  set = add(set, "a");
  set = add(set, "b");
  set = add(set, "a");
  assert.equal(has(set, "a"), true);
  assert.equal(has(set, "c"), false);
  assert.equal(set.size, 2);
  set = remove(set, "a");
  assert.equal(has(set, "a"), false);
  assert.deepEqual(sorted(set), ["b"]);
});

test("hands back the set itself when nothing changes", () => {
  const set = from(["a", "b"]);
  assert.equal(add(set, "a"), set);
  assert.equal(remove(set, "c"), set);
});

test("never changes the set it was handed", () => {
  const before = from(["a", "b"]);
  const copy = structuredClone(before);
  add(before, "c");
  remove(before, "a");
  assert.deepEqual(before, copy);
});

test("two sets holding the same items are equal, however they came to hold them", () => {
  const one = from(["a", "b", "c"]);
  const two = remove(add(from(["c", "x", "a"]), "b"), "x");
  assert.deepStrictEqual(one, two);
  assert.deepStrictEqual(remove(from(["a"]), "a"), empty());
});
