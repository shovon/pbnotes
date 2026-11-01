/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockCreated, pagesFold, propertySet } from "@pbnotes/pages";
import type { Pages } from "@pbnotes/pages";
import { getView } from "./place-view.ts";

const TODAY = "2026-09-21";
const TOMORROW = "2026-09-22";

/** The fold over `events`, as a ledger would hold it, at version 7. */
function folded(...events: { type: string; v: number; payload: unknown }[]) {
  const state: Pages = events.reduce(pagesFold.reduce, pagesFold.initial);
  return { state, version: 7 };
}

test("the view is labelled with the version it was read at", () => {
  assert.equal(getView(folded(), undefined, TODAY).version, 7);
});

test("the view is the journal with today on top, or the one page asked for", () => {
  const view = folded(blockCreated(TODAY, "saw [[Mira]]", undefined, "b1"));

  // Tomorrow has nothing on it yet, and is still where the user will type.
  const journal = getView(view, undefined, TOMORROW);
  assert.deepEqual(
    journal.showing.map((shown) => shown.page.title),
    [TOMORROW, TODAY],
  );

  const page = getView(view, { page: "Mira" }, TOMORROW);
  assert.equal(page.showing.length, 1);
  assert.deepEqual(
    page.showing[0].references.map((cut) => [cut.title, cut.blocks[0].text]),
    [[TODAY, "saw [[Mira]]"]],
  );

  // Zoomed, what links to the page is not shown.
  const zoomed = getView(view, { page: "Mira", block: "b1" }, TOMORROW);
  assert.deepEqual(zoomed.showing[0].references, []);
});

test("a day dated after today keeps its place above it", () => {
  const view = folded(blockCreated(TOMORROW, "from a fast clock", undefined, "b1"));
  assert.deepEqual(
    getView(view, undefined, TODAY).showing.map((shown) => shown.page.title),
    [TOMORROW, TODAY],
  );
});

test("every page in the view carries its properties, whether or not it has blocks", () => {
  const view = folded(
    blockCreated(TODAY, "saw [[Mira]]", undefined, "b1"),
    propertySet(TODAY, "Weather", "rain"),
    propertySet("Mira", "Role", "editor"),
  );

  const journal = getView(view, undefined, TOMORROW);
  assert.deepEqual(
    journal.showing.map((shown) => [shown.page.title, shown.properties]),
    [
      [TOMORROW, []],
      [TODAY, [{ key: "Weather", value: "rain" }]],
    ],
  );

  // A page with properties and no blocks.
  const mira = getView(view, { page: "Mira" }, TOMORROW);
  assert.deepEqual(mira.showing[0].properties, [{ key: "Role", value: "editor" }]);

  // Under a zoom too: drawing them or not is the window's call.
  const zoomed = getView(view, { page: TODAY, block: "b1" }, TOMORROW);
  assert.deepEqual(zoomed.showing[0].properties, [{ key: "Weather", value: "rain" }]);
});
