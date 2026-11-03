/**
 * Run with: npm test
 *
 * The alias fold through the gate, with no log around it: events are plain
 * objects, and each test is its own composition root. What a name opens is
 * `resolve.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../events/events.ts";
import { addBlock, getAliases, getEdited, graphFold, hasContent, pageDeleted } from "../graph.ts";
import type { Graph, GraphView } from "../graph.ts";
import { aliasAdded, aliasRemoved, reduce } from "./aliases.ts";

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

test("a page holds an alias once, and the later event on one alias wins", () => {
  const once = fold([added("JavaScript", "JS")]);
  assert.equal(graphFold.reduce(once, added("javascript", " js ")), once);
  assert.deepEqual(fold([added("A", "B"), removed("A", "B")]).aliases, new Map());
  assert.deepEqual(getAliases(fold([removed("A", "B"), added("A", "B")]), "A"), ["B"]);
});

test("an added and a removed from two writers end with whichever folds later, alike every time", () => {
  const a = added("A", "B");
  const b = removed("A", "B");
  assert.deepEqual(getAliases(fold([a, b]), "A"), []);
  assert.deepEqual(getAliases(fold([b, a]), "A"), ["B"]);
});

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

test("a malformed alias event is skipped whole, and extra fields are ignored", () => {
  const type = `${NAMESPACE}alias.added`;
  const none = graphFold.initial;
  for (const payload of [
    null,
    "A",
    [],
    { page: "A" },
    { alias: "B" },
    { page: 1, alias: "B" },
    { page: "A", alias: "   " },
    { page: " ", alias: "B" },
    Object.create({ page: "A", alias: "B" }),
  ]) {
    assert.equal(graphFold.reduce(none, { type, v: 1, payload }), none, JSON.stringify(payload));
  }
  const extra = graphFold.reduce(none, { type, v: 1, payload: { page: "A", alias: "B", why: 1 } });
  assert.deepEqual(getAliases(extra, "A"), ["B"]);
  assert.equal(graphFold.reduce(none, { type, v: 2, payload: { page: "A", alias: "B" } }), none);
});

test("`__proto__` is an ordinary page and an ordinary alias", () => {
  const state = fold([added("__proto__", "toString"), added("constructor", "__proto__")]);
  assert.deepEqual([...state.aliases.keys()].sort(), ["__proto__", "constructor"]);
});

test("the alias fold hands back what it was given for another slice's event", () => {
  const state = graphFold.initial;
  const tag = { type: `${NAMESPACE}tag.added`, payload: { page: "A", tag: "B" } };
  assert.equal(reduce(state, tag), state);
});

test("an alias is something on its page: it counts as content, an edit, and a delete takes it", () => {
  const at = "2026-11-03T10:00:00.000Z";
  const state = fold([{ ...added("A", "B"), at }]);
  assert.equal(hasContent(state, "a"), true);
  assert.equal(hasContent(state, "b"), false);
  assert.equal(getEdited(state, "A"), Date.parse(at));
  const deleted = fold([pageDeleted("A")], state);
  assert.equal(deleted.aliases.has("a"), false);
  assert.equal(hasContent(deleted, "a"), false);
});
