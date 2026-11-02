/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readOffer } from "./block-menu.ts";

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
