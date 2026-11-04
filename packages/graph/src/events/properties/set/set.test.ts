/**
 * Run with: npm test
 *
 * `property.set` on its own: what it folds to, how it is written, and how it
 * is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, getProperties, graphFold, holds, invert } from "../../../graph.ts";
import type { Graph, GraphView } from "../../../graph.ts";
import { PROPERTY_SET, propertySet } from "./set.ts";
import { propertyRemoved } from "../removed/removed.ts";

type Event = { type: string; v: number; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const set = (page: string, key: string, value: string): Event => propertySet(page, key, value);
const removed = (page: string, key: string): Event => propertyRemoved(page, key);

/** A view over the fold alone, for writing blocks with the app's commands. */
function memory(): GraphView {
  let state: Graph = graphFold.initial;
  return {
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      state = graphFold.reduce(state, { type, v, payload });
    },
  };
}

test("a set gives the page that property, and names both the page and the key", () => {
  const state = fold([set("Bar", "Widget", "blue")]);
  assert.deepEqual(getProperties(state, "bar"), [{ key: "Widget", value: "blue" }]);
  assert.equal(state.titles.get("bar"), "Bar");
  assert.equal(state.titles.get("widget"), "Widget");
  assert.equal(state.blocks.size, 0);
});

test("a set over a populated state keeps what was there", async () => {
  const view = memory();
  await addBlock(view, "Foo", "see [[Baz]]", undefined, "f");
  const before = view.state;
  const state = fold([set("Bar", "Widget", "blue"), set("Foo", "Status", "done")], before);
  assert.equal(state.blocks, before.blocks);
  assert.deepEqual(getProperties(state, "Foo"), [{ key: "Status", value: "done" }]);
  assert.deepEqual(getProperties(state, "Bar"), [{ key: "Widget", value: "blue" }]);
  assert.equal(state.titles.get("baz"), "Baz");
});

test("a value is a plain string: empty is kept, and a link in it names nothing", () => {
  const state = fold([set("Bar", "Empty", ""), set("Bar", "Link", "[[Gadget]]")]);
  assert.deepEqual(getProperties(state, "Bar"), [
    { key: "Empty", value: "" },
    { key: "Link", value: "[[Gadget]]" },
  ]);
  assert.equal(state.titles.has("gadget"), false);
});

test("propertySet writes the event's own type and v", () => {
  assert.deepEqual(propertySet("Bar", "K", "v"), {
    v: PROPERTY_SET.v,
    type: PROPERTY_SET.type,
    payload: { page: "Bar", key: "K", value: "v" },
  });
});

test("a set is undone back to the old value, by a removed when there was none, and not at all when nothing changed", () => {
  const before = fold([set("Bar", "K", "1")]);
  assert.deepEqual(invert(before, [set("Bar", "K", "2")]), [set("Bar", "K", "1")]);
  assert.deepEqual(invert(before, [set("Bar", "New", "x")]), [removed("Bar", "New")]);
  assert.deepEqual(invert(before, [set("bar", "k", "1")]), [], "the value it had");
});

test("a set holds until someone else changes that key", () => {
  const after = fold([set("Bar", "K", "1")]);
  const step = { before: graphFold.initial, events: [set("Bar", "K", "1")], after };
  assert.equal(holds(fold([set("Bar", "Other", "x")], after), step), true, "another key");
  assert.equal(holds(fold([set("Bar", "K", "2")], after), step), false);
  assert.equal(holds(fold([removed("Bar", "K")], after), step), false);
});
