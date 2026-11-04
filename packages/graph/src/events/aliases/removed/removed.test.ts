/**
 * Run with: npm test
 *
 * `alias.removed` on its own: what it folds to, how it is written, and how it
 * is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphFold, holds, invert } from "../../../graph.ts";
import type { Graph } from "../../../graph.ts";
import { aliasAdded } from "../added/added.ts";
import { ALIAS_REMOVED, aliasRemoved } from "./removed.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const added = (page: string, alias: string): Event => aliasAdded(page, alias);
const removed = (page: string, alias: string): Event => aliasRemoved(page, alias);

test("removing an alias the page lacks changes nothing but the spelling", () => {
  const before = fold([added("A", "B")]);
  const after = graphFold.reduce(before, removed("A", "C"));
  assert.equal(after.aliases, before.aliases);
  assert.equal(after.titles.get("c"), "C");
  assert.equal(graphFold.reduce(after, removed("a", "c")), after);
});

test("removing a page's last alias deletes its entry", () => {
  const state = fold([added("A", "B"), added("A", "C"), removed("A", "B"), removed("A", "C")]);
  assert.equal(state.aliases.has("a"), false);
});

test("aliasRemoved writes the event's own type and v", () => {
  assert.deepEqual(aliasRemoved("A", "B"), {
    v: ALIAS_REMOVED.v,
    type: ALIAS_REMOVED.type,
    payload: { page: "A", alias: "B" },
  });
});

test("a removed is undone by an added, spelled as written, and not at all when the page lacked it", () => {
  const before = fold([added("A", "B")]);
  const after = fold([removed("A", "B")], before);
  assert.deepEqual(invert(before, [removed("a", "b")]), [added("a", "b")]);
  assert.deepEqual(fold([added("A", "B")], after).aliases, before.aliases);
  assert.deepEqual(invert(after, [removed("A", "B")]), [], "already lacked it");
});

test("a removed holds until someone else gives the alias back", () => {
  const before = fold([added("A", "B")]);
  const after = fold([removed("A", "B")], before);
  const step = { before, events: [removed("A", "B")], after };
  assert.equal(holds(after, step), true);
  assert.equal(holds(fold([added("A", "B")], after), step), false);
});
