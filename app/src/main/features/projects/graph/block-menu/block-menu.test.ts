/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutLabel, deleteLabel, readOffer } from "./block-menu.ts";

test("an offer to delete is read", () => {
  assert.deepEqual(readOffer({ delete: true }), { delete: true });
});

test("no offer, or one that does not parse, offers nothing more", () => {
  for (const offer of [undefined, null, "delete", {}, { delete: false }, { delete: "yes" }, { delete: 1 }]) {
    assert.deepEqual(readOffer(offer), {});
  }
});

test("what an offer does not name is left out", () => {
  assert.deepEqual(readOffer({ delete: true, zoom: true }), { delete: true });
});

test("a delete of several carries its count, and one that is not several is the block alone (#258)", () => {
  assert.deepEqual(readOffer({ delete: true, count: 3 }), { delete: true, count: 3 });
  for (const count of [1, 0, -2, 2.5, "3", NaN, Infinity]) {
    assert.deepEqual(readOffer({ delete: true, count }), { delete: true }, String(count));
  }
  assert.deepEqual(readOffer({ count: 3 }), {}, "a count with no delete offers nothing");
});

test("Copy Block Reference is hidden by a plain false, and by nothing else (#261)", () => {
  assert.deepEqual(readOffer({ reference: false }), { reference: false });
  assert.deepEqual(readOffer({ reference: false, delete: true, count: 3 }), {
    reference: false,
    delete: true,
    count: 3,
  });
  for (const reference of [true, 0, "false", null, undefined]) {
    assert.deepEqual(readOffer({ reference, delete: true }), { delete: true }, String(reference));
  }
});

test("the delete item names how many blocks go", () => {
  assert.equal(deleteLabel({ delete: true }), "Delete Block");
  assert.equal(deleteLabel({ delete: true, count: 3 }), "Delete 3 Blocks");
});

test("the cut item names how many blocks go, as the delete item does (#246)", () => {
  assert.equal(cutLabel({ delete: true }), "Cut Block");
  assert.equal(cutLabel({ delete: true, count: 3 }), "Cut 3 Blocks");
});
