/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPoint } from "./ipc.ts";

test("a point is rounded to whole pixels", () => {
  assert.deepEqual(readPoint({ x: 10.4, y: 20.6 }), { x: 10, y: 21 });
});

test("a point that is not two finite numbers is none", () => {
  for (const at of [undefined, null, 3, {}, { x: 1 }, { x: "1", y: 2 }, { x: NaN, y: 2 }, { x: 1, y: Infinity }]) {
    assert.equal(readPoint(at), undefined);
  }
});
