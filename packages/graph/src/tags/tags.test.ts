/**
 * Run with: npm test
 *
 * The tag fold through the gate, with no log around it: events are plain
 * objects, and each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../events/events.ts";
import {
  addBlock,
  getEdited,
  graphFold,
  hasContent,
  listPages,
  pageDeleted,
  searchPages,
} from "../graph.ts";
import type { Graph, GraphView } from "../graph.ts";
import { getTaggedBy, getTags } from "./tags.ts";
import { predictTags, reduce } from "../events/tags/slice.ts";
import { tagAdded } from "../events/tags/added/added.ts";
import { tagRemoved } from "../events/tags/removed/removed.ts";
import { get } from "../immutable/immutable.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const added = (page: string, tag: string): Event => tagAdded(page, tag);
const removed = (page: string, tag: string): Event => tagRemoved(page, tag);

test("a page holds a tag once, and the later event on one tag wins", () => {
  const twice = fold([added("Foo", "Work")]);
  assert.equal(graphFold.reduce(twice, added("foo", " WORK ")), twice);
  assert.deepEqual(getTags(fold([added("Foo", "W"), removed("Foo", "W")]), "Foo"), []);
  assert.deepEqual(getTags(fold([removed("Foo", "W"), added("Foo", "W")]), "Foo"), ["W"]);
});

test("an added and a removed from two writers end with whichever folds later, alike every time", () => {
  const a = added("Foo", "W");
  const b = removed("Foo", "W");
  assert.deepEqual(fold([a, b]), fold([a, b]));
  assert.deepEqual(fold([b, a]), fold([b, a]));
  assert.deepEqual(getTags(fold([a, b]), "Foo"), []);
  assert.deepEqual(getTags(fold([b, a]), "Foo"), ["W"]);
});

test("tags compare through canonicalize, and show the first spelling the fold saw", async () => {
  const view = memory();
  await addBlock(view, "Foo", "[[WORK]]", undefined, "f");
  const state = fold([added("foo", "Work"), added("Other", "Fresh"), added("Other", " fresh ")], view.state);
  assert.deepEqual(getTags(state, "Foo"), ["WORK"]);
  assert.deepEqual(getTags(state, "other"), ["Fresh"]);
  assert.equal(get(state.titles, "foo"), "Foo");
});

test("a page named only by tags is a page: search and the page list find it, and the tag", () => {
  const state = fold([added("Foo", "Work")]);
  assert.deepEqual(searchPages(state, ""), ["Foo", "Work"]);
  assert.deepEqual(searchPages(state, "wo"), ["Work"]);
  assert.deepEqual(
    listPages(state).map(({ title }) => title),
    ["Foo", "Work"],
  );
});

test("a tag names a page, never creates one: removing it unnames both", () => {
  const state = fold([added("Foo", "Work"), removed("Foo", "Work")]);
  assert.equal(state.tags.size, 0);
  assert.deepEqual(searchPages(state, ""), []);
  // The spelling stays, as a link's does once the link is gone.
  assert.equal(get(state.titles, "work"), "Work");
});

test("getTaggedBy lists every page tagging a page, and drops one when its tag goes", () => {
  const state = fold([added("b", "Work"), added("A", "work"), added("C", "Home")]);
  assert.deepEqual(getTaggedBy(state, "Work"), ["A", "b"]);
  assert.deepEqual(getTaggedBy(fold([removed("A", "Work")], state), "Work"), ["b"]);
  assert.deepEqual(getTaggedBy(state, "Nothing"), []);
});

test("a page may tag itself", () => {
  assert.deepEqual(getTags(fold([added("Foo", "foo")]), "Foo"), ["Foo"]);
});

test("tags list by canonicalize(tag), whatever order they were added in", () => {
  const state = fold([added("P", "b"), added("P", "C"), added("P", "A")]);
  assert.deepEqual(getTags(state, "P"), ["A", "b", "C"]);
});

test("a malformed event is skipped whole and leaves the same state", () => {
  const state = fold([added("Foo", "A")]);
  const payloads: [string, unknown][] = [
    ["not an object", "Foo"],
    ["null", null],
    ["page not a string", { page: 1, tag: "T" }],
    ["page blank", { page: "  ", tag: "T" }],
    ["tag not a string", { page: "Foo", tag: ["T"] }],
    ["tag blank", { page: "Foo", tag: "" }],
    ["tag missing", { page: "Foo" }],
    ["inherited fields", Object.create({ page: "Foo", tag: "T" })],
  ];
  for (const name of ["tag.added", "tag.removed"]) {
    for (const [why, payload] of payloads) {
      assert.equal(graphFold.reduce(state, { type: `${NAMESPACE}${name}`, v: 1, payload }), state, `${name}: ${why}`);
    }
  }
});

test("an extra field folds as if it were absent", () => {
  const type = `${NAMESPACE}tag.added`;
  const extra = { type, v: 1, payload: { page: "Foo", tag: "T", colour: "red" } };
  assert.deepEqual(fold([extra]), fold([added("Foo", "T")]));
});

test("__proto__ is an ordinary page and an ordinary tag", () => {
  const state = fold([added("__proto__", "__proto__"), added("Foo", "constructor")]);
  assert.deepEqual(getTags(state, "__proto__"), ["__proto__"]);
  assert.deepEqual(getTags(state, "Foo"), ["constructor"]);
  assert.deepEqual(getTags(state, "toString"), []);
});

test("a newer v than this build reads is skipped by the gate", () => {
  const state = graphFold.initial;
  assert.equal(graphFold.reduce(state, { ...added("Foo", "T"), v: 2 }), state);
});

test("the tag fold leaves the state alone for a block event, and carries what it does not hold", () => {
  const state = { ...graphFold.initial, extra: 1 };
  const block = { type: `${NAMESPACE}block.created`, payload: { page: "P", id: "b", text: "x" } };
  assert.equal(reduce(state, block), state);
  assert.equal(reduce(state, added("Foo", "T")).extra, 1);
});

test("deleting a page takes its tags, and leaves the tags other pages point at it with", () => {
  const state = fold([added("Foo", "Work"), added("Bar", "Foo")]);
  assert.equal(hasContent(fold([added("Only", "Tagged")]), "Only"), true);
  const deleted = fold([pageDeleted("Foo")], state);
  assert.deepEqual(getTags(deleted, "Foo"), []);
  assert.deepEqual(getTaggedBy(deleted, "Foo"), ["Bar"]);
  assert.deepEqual(searchPages(deleted, ""), ["Bar", "Foo"]);
});

test("a tag change is an edit to the page it is on; a repeat is not", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const later = "2026-11-02T11:00:00.000Z";
  const state = fold([{ ...added("Foo", "Work"), at }]);
  assert.equal(getEdited(state, "Foo"), Date.parse(at));
  assert.equal(getEdited(state, "Work"), undefined);
  assert.equal(getEdited(fold([{ ...added("Foo", "Work"), at: later }], state), "Foo"), Date.parse(at));
  assert.equal(getEdited(fold([{ ...removed("Foo", "Work"), at: later }], state), "Foo"), Date.parse(later));
});

/** A view over a plain list of events, folded through the gate. */
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

test("predictTags folds writes in flight over the tags a page was sent", () => {
  assert.deepEqual(
    predictTags(["Home", "Work"], "Foo", [added("Foo", "Reading"), removed("foo", "home"), added("Foo", "WORK")]),
    ["Reading", "Work"],
  );
});

test("predictTags passes over other pages' writes and events that are not its own", () => {
  const block = { type: `${NAMESPACE}block.edited`, payload: { id: "b", text: "x" } };
  assert.deepEqual(predictTags(["Work"], "Foo", [added("Bar", "Home"), removed("Bar", "Work"), block]), ["Work"]);
  assert.deepEqual(predictTags([], "Foo", [removed("Foo", "Work")]), []);
});

test("predicting a write the tags already show changes nothing", () => {
  const events = [added("Foo", "Reading"), removed("Foo", "Home")];
  const once = predictTags(["Home"], "Foo", events);
  assert.deepEqual(once, ["Reading"]);
  assert.deepEqual(predictTags(once, "Foo", events), once);
});
