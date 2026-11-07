/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { namesIn } from "./lists.ts";

test("#[[A]] #[[B]], space-separated", () => {
  assert.deepEqual(namesIn("#[[Self Development]] #[[Social Skills]]"), {
    names: ["Self Development", "Social Skills"],
    blanks: 0,
  });
});

test("A, B: a bare item runs to the comma", () => {
  assert.deepEqual(namesIn("Self Development, Social Skills"), {
    names: ["Self Development", "Social Skills"],
    blanks: 0,
  });
});

test("[[A]], #B, and #C [[D]] mixed", () => {
  assert.deepEqual(namesIn("[[A]], #B #C [[D]]").names, ["A", "B", "C", "D"]);
});

test("a nested link is one name", () => {
  assert.deepEqual(namesIn("[[a [[b]] c]]").names, ["a [[b]] c"]);
});

test("a blank item is skipped and counted", () => {
  assert.deepEqual(namesIn("A, , B"), { names: ["A", "B"], blanks: 1 });
  assert.deepEqual(namesIn("[[]] #[[ ]] A"), { names: ["A"], blanks: 2 });
  assert.deepEqual(namesIn(""), { names: [], blanks: 0 });
});

test("a trailing comma is not a blank", () => {
  assert.deepEqual(namesIn("A, B,"), { names: ["A", "B"], blanks: 0 });
});
