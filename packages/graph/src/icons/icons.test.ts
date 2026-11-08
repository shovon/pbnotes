/**
 * Run with: npm test
 *
 * The icon slice through the gate, beside the rest of the graph: what an icon
 * does to a page as a whole, the prediction, and the reads. Each test is its
 * own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliasAdded,
  batch,
  getEdited,
  getIcon,
  getPage,
  graphFold,
  hasContent,
  invert,
  listPages,
  pageDeleted,
  pageRenamed,
  predictIcon,
  propertySet,
  resolve,
  searchPages,
  tagAdded,
} from "../graph.ts";
import type { Graph } from "../graph.ts";
import { iconSet } from "../events/icons/set/set.ts";
import { iconRemoved } from "../events/icons/removed/removed.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

test("an icon names its page: it is listed, searched and has content", () => {
  const state = fold([iconSet("Foo", "🌲")]);
  assert.deepEqual(searchPages(state, "fo"), ["Foo"]);
  assert.deepEqual(listPages(state).map(({ title }) => title), ["Foo"]);
  assert.equal(hasContent(state, "foo"), true);
  assert.deepEqual(getPage(state, "Foo").blocks, []);
});

test("a page only an icon names stops being one when the icon goes", () => {
  const state = fold([iconSet("Foo", "🌲"), iconRemoved("Foo")]);
  assert.deepEqual(searchPages(state, "fo"), []);
  assert.equal(hasContent(state, "Foo"), false);
});

test("setting an icon is an edit of its page", () => {
  const state = fold([{ ...iconSet("Foo", "🌲"), at: "2026-11-08T10:00:00.000Z" }]);
  assert.equal(getEdited(state, "Foo"), Date.parse("2026-11-08T10:00:00.000Z"));
});

test("a page's icon reads through its aliases", () => {
  const state = fold([iconSet("JavaScript", "📜"), aliasAdded("JavaScript", "JS")]);
  assert.equal(getIcon(state, "JS"), "📜");
});

test("an icon on a name is a page of its own: it is never hidden behind an alias", () => {
  const state = fold([aliasAdded("JavaScript", "JS"), iconSet("JS", "🟨")]);
  assert.equal(resolve(state, "JS"), "JS");
  assert.equal(getIcon(state, "JS"), "🟨");
  assert.equal(getIcon(state, "JavaScript"), undefined);
});

test("a delete takes the icon with the page, and its undo brings it back", () => {
  const before = fold([iconSet("Foo", "🌲"), tagAdded("Foo", "Trees")]);
  const after = fold([pageDeleted("Foo")], before);
  assert.equal(getIcon(after, "Foo"), undefined);
  const undo = invert(before, [pageDeleted("Foo")]);
  assert.ok(undo);
  assert.equal(getIcon(fold([batch(undo)], after), "Foo"), "🌲");
});

test("an icon set after a delete, in fold order, is a later fact and stands", () => {
  const state = fold([iconSet("Foo", "🌲"), pageDeleted("Foo"), iconSet("Foo", "🌊")]);
  assert.equal(getIcon(state, "Foo"), "🌊");
});

test("a rename takes the icon to the new title", () => {
  const state = fold([iconSet("Lake", "🌊"), pageRenamed("Lake", "Lake Lindeman")]);
  assert.equal(getIcon(state, "Lake Lindeman"), "🌊");
  // The old title is an alias now, so it still reads the moved icon.
  assert.equal(getIcon(state, "Lake"), "🌊");
});

test("a set on the old title after a rename lands on the page it became", () => {
  const state = fold([propertySet("Lake", "Depth", "60 m"), pageRenamed("Lake", "Tarn"), iconSet("Lake", "🌊")]);
  assert.equal(getIcon(state, "Tarn"), "🌊");
});

test("a rename onto a page with only an icon is refused, like any page with content", () => {
  const state = fold([propertySet("A", "k", "v"), iconSet("B", "🌲"), pageRenamed("A", "B")]);
  assert.deepEqual(
    [getIcon(state, "B"), resolve(state, "A")],
    ["🌲", "A"],
  );
});

test("predictIcon folds writes in flight over the icon main sent, and passes over the rest", () => {
  assert.equal(predictIcon(undefined, "Foo", []), undefined);
  assert.equal(predictIcon("🌲", "Foo", [iconSet("foo", "🌊")]), "🌊");
  assert.equal(predictIcon("🌲", "Foo", [iconRemoved("Foo")]), undefined);
  assert.equal(predictIcon(undefined, "Foo", [iconSet("Bar", "🌊"), tagAdded("Foo", "x")]), undefined);
  assert.equal(predictIcon("🌲", "Foo", [batch([iconRemoved("Foo"), iconSet("Foo", "🌊")])]), "🌊");
});
