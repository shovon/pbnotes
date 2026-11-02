/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readOffer, readPoint } from "./page-menu.ts";

test("an offer to delete is read", () => {
  assert.deepEqual(readOffer({ delete: true }), { delete: true });
});

test("no offer, or one that does not parse, leaves delete disabled", () => {
  for (const offer of [undefined, null, "delete", {}, { delete: false }, { delete: "yes" }, { delete: 1 }]) {
    assert.deepEqual(readOffer(offer), {});
  }
});

test("what an offer does not name is left out", () => {
  assert.deepEqual(readOffer({ delete: true, rename: true }), { delete: true });
});

test("a point is rounded to whole pixels", () => {
  assert.deepEqual(readPoint({ x: 10.4, y: 20.6 }), { x: 10, y: 21 });
});

test("a point that is not two finite numbers is none", () => {
  for (const at of [undefined, null, 3, {}, { x: 1 }, { x: "1", y: 2 }, { x: NaN, y: 2 }, { x: 1, y: Infinity }]) {
    assert.equal(readPoint(at), undefined);
  }
});
