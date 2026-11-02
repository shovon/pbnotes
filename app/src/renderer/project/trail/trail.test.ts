/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { back, go, leave, rezoom } from "./trail.ts";

test("a link to where the view already is adds nothing", () => {
  const trail = go(go([], { page: "Mira" }), { page: "Mira" });
  assert.deepEqual(trail, [{ page: "Mira" }]);
  // In any case (#83): it is the same page.
  assert.equal(go(trail, { page: "mira" }), trail);
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

test("leaving a deleted page goes back past every stop on it, zooms included", () => {
  const trail = [
    { page: "Bar" },
    { page: "Foo" },
    { page: "Baz" },
    { page: "Foo" },
    { page: "foo", block: "b1" },
    { page: "FOO", block: "b2" },
  ];
  assert.deepEqual(leave(trail, "Foo"), [{ page: "Bar" }, { page: "Foo" }, { page: "Baz" }]);
});

test("leaving with nothing else on the trail lands on the journal", () => {
  assert.deepEqual(leave([{ page: "Foo" }, { page: "Foo", block: "b" }], "foo"), []);
  assert.deepEqual(leave([], "Foo"), []);
});

test("leaving a page the view is not on changes nothing", () => {
  const trail = [{ page: "Foo" }, { page: "Bar" }];
  assert.deepEqual(leave(trail, "Foo"), trail);
});
