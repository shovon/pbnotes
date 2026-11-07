/**
 * Run with: npm test
 *
 * `property.removed` on its own: what it folds to, how it is written, and how
 * it is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getProperties, graphFold, holds, invert, remember } from "../../../graph.ts";
import type { Graph } from "../../../graph.ts";
import { propertySet } from "../set/set.ts";
import { PROPERTY_REMOVED, propertyRemoved } from "./removed.ts";
import { get, has } from "../../../immutable/immutable.ts";

type Event = { type: string; v: number; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const set = (page: string, key: string, value: string): Event => propertySet(page, key, value);
const removed = (page: string, key: string): Event => propertyRemoved(page, key);

test("removing a page's last property deletes its entry; removing one of two keeps the other", () => {
  const two = fold([set("Bar", "A", "1"), set("Bar", "B", "2")]);
  assert.deepEqual(getProperties(fold([removed("Bar", "A")], two), "Bar"), [{ key: "B", value: "2" }]);
  assert.equal(has(fold([removed("Bar", "A"), removed("Bar", "B")], two).properties, "bar"), false);
});

test("removing a key the page lacks changes nothing but the spellings", () => {
  const state = fold([set("Bar", "A", "1"), set("Other", "B", "2")]);
  assert.equal(graphFold.reduce(state, removed("bar", "b")), state);
  const named = graphFold.reduce(state, removed("Bar", "Nothing"));
  assert.equal(named.properties, state.properties);
  assert.equal(get(named.titles, "nothing"), "Nothing");
});

test("propertyRemoved writes the event's own type and v", () => {
  assert.deepEqual(propertyRemoved("Bar", "K"), {
    v: PROPERTY_REMOVED.v,
    type: PROPERTY_REMOVED.type,
    payload: { page: "Bar", key: "K" },
  });
});

test("a removed is undone by setting the old value back, and not at all when the page lacked the key", () => {
  const before = fold([set("Bar", "K", "1")]);
  assert.deepEqual(invert(before, [removed("Bar", "K")]), [set("Bar", "K", "1")]);
  assert.deepEqual(invert(before, [removed("Bar", "Nothing")]), [], "already lacked it");
});

test("a removed holds until someone else sets the key again", () => {
  const before = fold([set("Bar", "K", "1")]);
  const after = fold([removed("Bar", "K")], before);
  const step = remember(before, [removed("Bar", "K")]);
  assert.equal(holds(after, step), true);
  assert.equal(holds(fold([set("Bar", "K", "2")], after), step), false);
});
