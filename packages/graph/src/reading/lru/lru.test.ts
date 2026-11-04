/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lru } from "./lru.ts";

test("holds no more than its limit, letting go of the oldest first", () => {
  const memo = lru<string, number>(2);
  memo.set("a", 1);
  memo.set("b", 2);
  memo.set("c", 3);
  assert.equal(memo.size, 2);
  assert.equal(memo.get("a"), undefined);
  assert.equal(memo.get("b"), 2);
  assert.equal(memo.get("c"), 3);
});

test("a hit counts as a use, so what is read keeps its place", () => {
  const memo = lru<string, number>(2);
  memo.set("a", 1);
  memo.set("b", 2);
  memo.get("a");
  memo.set("c", 3);
  assert.equal(memo.get("a"), 1);
  assert.equal(memo.get("b"), undefined);
});

test("setting a key it holds replaces it and takes no extra room", () => {
  const memo = lru<string, number>(2);
  memo.set("a", 1);
  memo.set("a", 2);
  memo.set("b", 3);
  assert.equal(memo.size, 2);
  assert.equal(memo.get("a"), 2);
});
