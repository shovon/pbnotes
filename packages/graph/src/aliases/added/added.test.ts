/**
 * Run with: npm test
 *
 * `alias.added` on its own: what it folds to, how it is written, and how it
 * is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, getAliases, graphFold, holds, invert } from "../../graph.ts";
import type { Graph, GraphView } from "../../graph.ts";
import { ALIAS_ADDED, aliasAdded } from "./added.ts";
import { aliasRemoved } from "../removed/removed.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const added = (page: string, alias: string): Event => aliasAdded(page, alias);
const removed = (page: string, alias: string): Event => aliasRemoved(page, alias);

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

test("an added gives the page that alias, and names both", () => {
  const state = fold([added("JavaScript", "JS")]);
  assert.deepEqual(state.aliases, new Map([["javascript", new Set(["js"])]]));
  assert.deepEqual(getAliases(state, "javascript"), ["JS"]);
  assert.equal(state.titles.get("javascript"), "JavaScript");
  assert.equal(state.titles.get("js"), "JS");
  assert.equal(state.blocks.size, 0);
});

test("an added over a populated state keeps what was there", async () => {
  const view = memory();
  await addBlock(view, "JavaScript", "see [[Node]]", undefined, "j");
  const before = view.state;
  const state = fold([added("JavaScript", "JS"), added("JavaScript", "ECMAScript")], before);
  assert.equal(state.blocks, before.blocks);
  assert.deepEqual(getAliases(state, "JavaScript"), ["ECMAScript", "JS"]);
  assert.equal(state.titles.get("node"), "Node");
});

test("aliasAdded writes the event's own type and v", () => {
  assert.deepEqual(aliasAdded("A", "B"), {
    v: ALIAS_ADDED.v,
    type: ALIAS_ADDED.type,
    payload: { page: "A", alias: "B" },
  });
});

test("an added is undone by a removed, and not at all when the page already had it", () => {
  const before = fold([added("Other", "X")]);
  const after = fold([added("A", "B")], before);
  assert.deepEqual(invert(before, [added("A", "B")]), [removed("A", "B")]);
  assert.deepEqual(fold([removed("A", "B")], after).aliases, before.aliases);
  assert.deepEqual(invert(after, [added("a", "b")]), [], "already had it");
});

test("an added holds until someone else takes the alias away", () => {
  const before = graphFold.initial;
  const after = fold([added("A", "B")]);
  const step = { before, events: [added("A", "B")], after };
  assert.equal(holds(fold([added("A", "C")], after), step), true, "another alias");
  assert.equal(holds(fold([removed("A", "B")], after), step), false);
});
