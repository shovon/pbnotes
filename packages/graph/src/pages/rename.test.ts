/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasAdded, aliasRemoved, blockCreated, getRenamed, graphFold, pageRenamed } from "../graph.ts";
import type { Batched, Graph } from "../graph.ts";

const fold = (...events: Batched[]): Graph => events.reduce(graphFold.reduce, graphFold.initial);
const page = (title: string, id = title) => blockCreated(title, "x", undefined, id);

test("a name a rename left behind gives the title of the page it became", () => {
  const state = fold(page("Beta"), pageRenamed("Beta", "Beta Two"));
  assert.deepEqual(getRenamed(state, ["Beta"]), [{ from: "Beta", to: "Beta Two" }]);
});

test("the name is matched in any spelling, and given back as it was asked", () => {
  const state = fold(page("Beta"), pageRenamed("Beta", "Beta Two"));
  assert.deepEqual(getRenamed(state, ["beta"]), [{ from: "beta", to: "Beta Two" }]);
});

test("a chain of renames gives the page at its end", () => {
  const state = fold(page("A"), pageRenamed("A", "B"), pageRenamed("B", "C"));
  assert.deepEqual(getRenamed(state, ["A", "B"]), [
    { from: "A", to: "C" },
    { from: "B", to: "C" },
  ]);
});

test("an alias someone added is not a rename", () => {
  const state = fold(page("JavaScript"), aliasAdded("JavaScript", "JS"));
  assert.deepEqual(getRenamed(state, ["JS"]), []);
});

test("a name whose alias was removed since is not a rename any more", () => {
  const state = fold(page("Beta"), pageRenamed("Beta", "Beta Two"), aliasRemoved("Beta Two", "Beta"));
  assert.deepEqual(getRenamed(state, ["Beta"]), []);
});

test("a page that was never renamed, and its new title, are not in the answer", () => {
  const state = fold(page("Beta"), page("Gamma"), pageRenamed("Beta", "Beta Two"));
  assert.deepEqual(getRenamed(state, ["Gamma", "Beta Two", "Nowhere"]), []);
});

test("a day renamed away leaves no name behind", () => {
  const state = fold(page("2026-11-04"), pageRenamed("2026-11-04", "Trip"));
  assert.deepEqual(getRenamed(state, ["2026-11-04"]), []);
});

test("a name asked twice is answered once", () => {
  const state = fold(page("Beta"), pageRenamed("Beta", "Beta Two"));
  assert.equal(getRenamed(state, ["Beta", "Beta"]).length, 1);
});
