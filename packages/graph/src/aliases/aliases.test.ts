/**
 * Run with: npm test
 *
 * The alias fold through the gate, with no log around it: events are plain
 * objects, and each test is its own composition root. What a name opens is
 * `resolve.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../event/event.ts";
import { getAliases, getEdited, graphFold, hasContent, pageDeleted } from "../graph.ts";
import type { Graph } from "../graph.ts";
import { aliasAdded } from "./added/added.ts";
import { aliasRemoved } from "./removed/removed.ts";
import { reduce } from "./slice.ts";
import { empty, has, keys } from "../immutable/immutable.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const added = (page: string, alias: string): Event => aliasAdded(page, alias);
const removed = (page: string, alias: string): Event => aliasRemoved(page, alias);

test("a page holds an alias once, and the later event on one alias wins", () => {
  const once = fold([added("JavaScript", "JS")]);
  assert.equal(graphFold.reduce(once, added("javascript", " js ")), once);
  assert.deepEqual(fold([added("A", "B"), removed("A", "B")]).aliases, empty());
  assert.deepEqual(getAliases(fold([removed("A", "B"), added("A", "B")]), "A"), ["B"]);
});

test("an added and a removed from two writers end with whichever folds later, alike every time", () => {
  const a = added("A", "B");
  const b = removed("A", "B");
  assert.deepEqual(getAliases(fold([a, b]), "A"), []);
  assert.deepEqual(getAliases(fold([b, a]), "A"), ["B"]);
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
  assert.deepEqual([...keys(state.aliases)].sort(), ["__proto__", "constructor"]);
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
  assert.equal(has(deleted.aliases, "a"), false);
  assert.equal(hasContent(deleted, "a"), false);
});
