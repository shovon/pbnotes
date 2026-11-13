/**
 * Run with: npm test
 *
 * Whether an alias opens its page (#383), and why not, for one held and one
 * only typed. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasAdded, blockCreated, graphFold, tagAdded } from "../../graph.ts";
import type { Graph } from "../../graph.ts";
import { aliasing, getHeldAliases } from "./effect.ts";

type Event = { type: string; v: number; payload: unknown };

const fold = (events: Event[]): Graph => events.reduce(graphFold.reduce, graphFold.initial);

/** A block on `page`, so it has a page of its own. */
const wrote = (page: string, id: string): Event => blockCreated(page, "x", undefined, id);

test("a free name would open the page, held or only typed", () => {
  const state = fold([wrote("JavaScript", "j")]);
  assert.equal(aliasing(state, "JavaScript", "JS"), undefined);
  const held = fold([wrote("JavaScript", "j"), aliasAdded("JavaScript", "JS")]);
  assert.equal(aliasing(held, "javascript", "js"), undefined);
  assert.deepEqual(getHeldAliases(held, "JavaScript"), [{ alias: "JS" }]);
});

test("the page's own title is the page, not an alias of it", () => {
  assert.deepEqual(aliasing(fold([]), "JavaScript", " javascript "), { why: "self" });
});

test("rule 1: a name with notes of its own opens itself", () => {
  const state = fold([wrote("JavaScript", "j"), wrote("JS", "k")]);
  assert.deepEqual(aliasing(state, "JavaScript", "JS"), { why: "own" });
  const tagged = fold([tagAdded("JS", "Work")]);
  assert.deepEqual(aliasing(tagged, "JavaScript", "JS"), { why: "own" });
});

test("rules 2 and 3: a date name opens its day, and a date is the day", () => {
  const state = fold([]);
  assert.deepEqual(aliasing(state, "Election", "Nov 4th, 2024"), { why: "day", day: "2024-11-04" });
  assert.deepEqual(aliasing(state, "Election", "2024-11-04"), { why: "date" });
});

test("rule 4: a name with aliases of its own opens itself", () => {
  const state = fold([aliasAdded("JS", "Jay")]);
  assert.deepEqual(aliasing(state, "JavaScript", "JS"), { why: "aliases" });
});

test("rule 5: of two pages that claim a name, the one whose key sorts first opens it", () => {
  const state = fold([aliasAdded("Python", "JS")]);
  assert.deepEqual(aliasing(state, "Snake", "JS"), { why: "claimed", by: "Python" });
  assert.equal(aliasing(state, "JavaScript", "JS"), undefined);
});

test("held aliases come ordered by key, spelt as first seen, each with why it is inert", () => {
  const state = fold([
    wrote("JavaScript", "j"),
    wrote("ecma", "e"),
    aliasAdded("JavaScript", "JS"),
    aliasAdded("JavaScript", "ECMA"),
    aliasAdded("JavaScript", "browser script"),
  ]);
  assert.deepEqual(getHeldAliases(state, "js"), [
    { alias: "browser script" },
    { alias: "ecma", inert: { why: "own" } },
    { alias: "JS" },
  ]);
  assert.deepEqual(getHeldAliases(state, "Nothing"), []);
});
