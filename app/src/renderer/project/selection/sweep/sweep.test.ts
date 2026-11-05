/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { begins, rowAt, swept, THRESHOLD } from "./sweep.ts";

/** Four rows, 20 tall, with a gap of 4 between: a 0–20, b 24–44, c 48–68, d 72–92. */
const ROWS = ["a", "b", "c", "d"].map((key, at) => ({ key, top: at * 24, bottom: at * 24 + 20 }));

test("the row at a point, and none in a gap or past either end", () => {
  assert.equal(rowAt(ROWS, 10), "a");
  assert.equal(rowAt(ROWS, 50), "c");
  assert.equal(rowAt(ROWS, 22), undefined);
  assert.equal(rowAt(ROWS, -5), undefined);
  assert.equal(rowAt(ROWS, 200), undefined);
});

test("a drag selects every row it touches, from where it started to where it is", () => {
  assert.deepEqual(swept(ROWS, 10, 50), { anchor: "a", head: "c" }, "down");
  assert.deepEqual(swept(ROWS, 80, 30), { anchor: "d", head: "b" }, "up");
  assert.deepEqual(swept(ROWS, 50, 60), { anchor: "c", head: "c" }, "within one row");
});

test("a drag from a gap or a margin is anchored on the first row it reaches", () => {
  assert.deepEqual(swept(ROWS, 22, 60), { anchor: "b", head: "c" }, "down from a gap");
  assert.deepEqual(swept(ROWS, 200, 30), { anchor: "d", head: "b" }, "up from below the last row");
  assert.deepEqual(swept(ROWS, -40, 5), { anchor: "a", head: "a" }, "down from above the first");
});

test("moving back shrinks the run, and a stretch touching no row selects nothing", () => {
  assert.deepEqual(swept(ROWS, 10, 80), { anchor: "a", head: "d" });
  assert.deepEqual(swept(ROWS, 10, 30), { anchor: "a", head: "b" });
  assert.equal(swept(ROWS, 21, 23), undefined, "inside a gap");
  assert.equal(swept(ROWS, 100, 300), undefined, "below every row");
  assert.equal(swept([], 0, 10), undefined);
});

test("from a blank area a press is a drag once it moves far enough; from a row, once it reaches another", () => {
  assert.equal(begins(ROWS, undefined, 10, THRESHOLD - 1), false, "a click");
  assert.equal(begins(ROWS, undefined, 10, THRESHOLD), true);
  assert.equal(begins(ROWS, "a", 15, 100), false, "still in its own row: selecting text");
  assert.equal(begins(ROWS, "a", 22, 100), false, "a gap is no row");
  assert.equal(begins(ROWS, "a", 30, 3), true, "another row, however little it moved");
});
