/**
 * Run with: npm test
 *
 * `tag.added` on its own: what it folds to, how it is written, and how it is
 * undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, graphFold, holds, invert } from "../../../graph.ts";
import type { Graph, GraphView } from "../../../graph.ts";
import { getTaggedBy, getTags } from "../../../tags/tags.ts";
import { TAG_ADDED, tagAdded } from "./added.ts";
import { tagRemoved } from "../removed/removed.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const added = (page: string, tag: string): Event => tagAdded(page, tag);
const removed = (page: string, tag: string): Event => tagRemoved(page, tag);

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

test("an added gives the page that tag, and names both pages", () => {
  const state = fold([added("Foo", "Work")]);
  assert.deepEqual(getTags(state, "foo"), ["Work"]);
  assert.deepEqual(getTaggedBy(state, "work"), ["Foo"]);
  assert.equal(state.titles.get("foo"), "Foo");
  assert.equal(state.titles.get("work"), "Work");
  assert.equal(state.blocks.size, 0);
});

test("an added over a populated state keeps what was there", async () => {
  const view = memory();
  await addBlock(view, "Foo", "see [[Baz]]", undefined, "f");
  const before = fold([added("Foo", "Work")], view.state);
  const state = fold([added("Foo", "Home"), added("Bar", "Work")], before);
  assert.equal(state.blocks, before.blocks);
  assert.deepEqual(getTags(state, "Foo"), ["Home", "Work"]);
  assert.deepEqual(getTags(state, "Bar"), ["Work"]);
  assert.equal(state.titles.get("baz"), "Baz");
});

test("tagAdded writes the event's own type and v", () => {
  assert.deepEqual(tagAdded("Foo", "Work"), {
    v: TAG_ADDED.v,
    type: TAG_ADDED.type,
    payload: { page: "Foo", tag: "Work" },
  });
});

test("an added is undone by a removed, and not at all when the page already had it", () => {
  const before = fold([added("Other", "X")]);
  const after = fold([added("Foo", "Work")], before);
  assert.deepEqual(invert(before, [added("Foo", "Work")]), [removed("Foo", "Work")]);
  assert.deepEqual(fold([removed("Foo", "Work")], after).tags, before.tags);
  assert.deepEqual(invert(after, [added("foo", "work")]), [], "already had it");
});

test("an added holds until someone else takes the tag away", () => {
  const after = fold([added("Foo", "Work")]);
  const step = { before: graphFold.initial, events: [added("Foo", "Work")], after };
  assert.equal(holds(fold([added("Foo", "Home")], after), step), true, "another tag");
  assert.equal(holds(fold([removed("Foo", "Work")], after), step), false);
});
