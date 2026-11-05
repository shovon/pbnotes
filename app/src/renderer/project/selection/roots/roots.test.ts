/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { covered, roots } from "./roots.ts";

/**
 *   p
 *     c1
 *       g
 *     c2
 *   q
 *   p'   (p again, under another page: same id, another key)
 *     c1'
 */
const order = [
  { key: "p", id: "P" },
  { key: "c1", parent: "p", id: "C1" },
  { key: "g", parent: "c1", id: "G" },
  { key: "c2", parent: "p", id: "C2" },
  { key: "q", id: "Q" },
  { key: "p2", id: "P" },
  { key: "c12", parent: "p2", id: "C1" },
];
const ids = (selected: string[]) => roots(order, selected).map((it) => it.id);

test("a parent selected with its child is the parent alone", () => {
  assert.deepEqual(ids(["p", "c1", "g"]), ["P"]);
});

test("a grandchild under a selected parent goes too, through one that is not selected", () => {
  assert.deepEqual(ids(["p", "g"]), ["P"]);
});

test("unrelated blocks come back in the order they show, whatever order they were picked", () => {
  assert.deepEqual(ids(["q", "c2", "g"]), ["G", "C2", "Q"]);
});

test("a block that shows twice is handed on once, where it first shows", () => {
  assert.deepEqual(ids(["c1", "c12"]), ["C1"]);
  assert.deepEqual(roots(order, ["c12", "p"]).map((it) => it.key), ["p"]);
});

test("nothing selected is nothing", () => {
  assert.deepEqual(ids([]), []);
});

test("a parent loop does not hang", () => {
  const loop = [
    { key: "x", parent: "y", id: "X" },
    { key: "y", parent: "x", id: "Y" },
  ];
  assert.deepEqual(roots(loop, ["x"]).map((it) => it.id), ["X"]);
});

test("what shows under a selected thing is covered, wherever that thing shows", () => {
  assert.deepEqual([...covered(order, ["p"])].sort(), ["c1", "c12", "c2", "g"]);
  assert.deepEqual([...covered(order, ["c1"])], ["g"]);
  assert.deepEqual([...covered(order, ["q"])], []);
});
