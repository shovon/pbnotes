/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { back, go, home, leave, rezoom } from "./trail.ts";
import type { Stop } from "./trail.ts";

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

test("home adds the journal as a stop, and back returns from it", () => {
  const trail = home([{ page: "Mira" }]);
  assert.deepEqual(trail, [{ page: "Mira" }, undefined]);
  assert.deepEqual(back(trail), [{ page: "Mira" }]);
});

test("home on the journal already adds nothing", () => {
  const start: Stop[] = [];
  assert.equal(home(start), start);
  const atJournal: Stop[] = [{ page: "Mira" }, undefined];
  assert.equal(home(atJournal), atJournal);
});

test("a page after the journal, then home again, is one stop each", () => {
  const trail = home(go(home([{ page: "Mira" }]), { page: "Bar" }));
  assert.deepEqual(trail, [{ page: "Mira" }, undefined, { page: "Bar" }, undefined]);
});

test("a link from a journal stop goes on after it", () => {
  assert.deepEqual(go([{ page: "Mira" }, undefined], { page: "Bar" }), [
    { page: "Mira" },
    undefined,
    { page: "Bar" },
  ]);
});

test("leaving a deleted page stops at a journal stop", () => {
  const trail: Stop[] = [{ page: "Bar" }, undefined, { page: "Foo" }, { page: "Foo", block: "b" }];
  assert.deepEqual(leave(trail, "foo"), [{ page: "Bar" }, undefined]);
});

test("leaving never leaves a journal stop first on the trail", () => {
  // Not reachable through `home`, which adds nothing to an empty trail, but
  // `leave` keeps the rule whatever it is handed.
  assert.deepEqual(leave([undefined, { page: "Foo" }], "Foo"), []);
});
