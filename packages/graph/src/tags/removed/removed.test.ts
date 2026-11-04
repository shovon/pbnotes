/**
 * Run with: npm test
 *
 * `tag.removed` on its own: what it folds to, how it is written, and how it
 * is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphFold, holds, invert } from "../../graph.ts";
import type { Graph } from "../../graph.ts";
import { getTags } from "../tags.ts";
import { tagAdded } from "../added/added.ts";
import { TAG_REMOVED, tagRemoved } from "./removed.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const added = (page: string, tag: string): Event => tagAdded(page, tag);
const removed = (page: string, tag: string): Event => tagRemoved(page, tag);

test("removing a page's last tag deletes its entry; removing one of two keeps the other", () => {
  const two = fold([added("Foo", "A"), added("Foo", "B")]);
  assert.deepEqual(getTags(fold([removed("Foo", "A")], two), "Foo"), ["B"]);
  assert.equal(fold([removed("Foo", "A"), removed("Foo", "B")], two).tags.has("foo"), false);
});

test("removing a tag the page lacks changes nothing but the spellings", () => {
  const state = fold([added("Foo", "A"), added("Other", "B")]);
  assert.equal(graphFold.reduce(state, removed("foo", "b")), state);
  const named = graphFold.reduce(state, removed("Foo", "Nothing"));
  assert.equal(named.tags, state.tags);
  assert.equal(named.titles.get("nothing"), "Nothing");
});

test("tagRemoved writes the event's own type and v", () => {
  assert.deepEqual(tagRemoved("Foo", "Work"), {
    v: TAG_REMOVED.v,
    type: TAG_REMOVED.type,
    payload: { page: "Foo", tag: "Work" },
  });
});

test("a removed is undone by an added, and not at all when the page lacked it", () => {
  const before = fold([added("Foo", "Work")]);
  const after = fold([removed("Foo", "Work")], before);
  assert.deepEqual(invert(before, [removed("Foo", "Work")]), [added("Foo", "Work")]);
  assert.deepEqual(fold([added("Foo", "Work")], after).tags, before.tags);
  assert.deepEqual(invert(after, [removed("Foo", "Work")]), [], "already lacked it");
});

test("a removed holds until someone else gives the tag back", () => {
  const before = fold([added("Foo", "Work")]);
  const after = fold([removed("Foo", "Work")], before);
  const step = { before, events: [removed("Foo", "Work")], after };
  assert.equal(holds(after, step), true);
  assert.equal(holds(fold([added("Foo", "Work")], after), step), false);
});
