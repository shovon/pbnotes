/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { back, go, rezoom } from "./trail.ts";

test("a link to where the view already is adds nothing", () => {
  const trail = go(go([], { page: "Mira" }), { page: "Mira" });
  assert.deepEqual(trail, [{ page: "Mira" }]);
  // A zoom within the page is somewhere else, and back returns from it.
  const zoomed = go(trail, { page: "Mira", block: "b" });
  assert.deepEqual(back(zoomed), trail);
  assert.deepEqual(back(back(zoomed)), []);
});

test("a zoom that moved replaces its stop, and never doubles the one before", () => {
  const trail = [{ page: "Mira" }, { page: "Mira", block: "child" }];
  assert.deepEqual(rezoom(trail, "parent"), [
    { page: "Mira" },
    { page: "Mira", block: "parent" },
  ]);
  // Out to the whole page, which is the stop before: back must not land on
  // the same place twice.
  assert.deepEqual(rezoom(trail), [{ page: "Mira" }]);
});
