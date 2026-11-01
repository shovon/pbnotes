/**
 * Run with: npm test
 *
 * The property fold through the gate, with no log around it: events are plain
 * objects, and each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../events/events.ts";
import { addBlock, getProperties, pagesFold, searchPages } from "../pages.ts";
import type { Pages, PagesView } from "../pages.ts";
import { predictProperties, propertyRemoved, propertySet, reduce } from "./properties.ts";

type Event = { type: string; v: number; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Pages = pagesFold.initial): Pages =>
  events.reduce(pagesFold.reduce, from);

const set = (page: string, key: string, value: string): Event => propertySet(page, key, value);
const removed = (page: string, key: string): Event => propertyRemoved(page, key);

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

test("the later of two events on one key wins", () => {
  assert.deepEqual(getProperties(fold([set("Bar", "K", "1"), set("Bar", "K", "2")]), "Bar"), [
    { key: "K", value: "2" },
  ]);
  assert.deepEqual(getProperties(fold([set("Bar", "K", "1"), removed("Bar", "K")]), "Bar"), []);
  assert.deepEqual(getProperties(fold([removed("Bar", "K"), set("Bar", "K", "1")]), "Bar"), [
    { key: "K", value: "1" },
  ]);
});

test("a set and a removed from two writers end with whichever folds later, alike every time", () => {
  const a = set("Bar", "K", "1");
  const b = removed("Bar", "K");
  assert.deepEqual(fold([a, b]), fold([a, b]));
  assert.deepEqual(fold([b, a]), fold([b, a]));
  assert.deepEqual(getProperties(fold([a, b]), "Bar"), []);
  assert.deepEqual(getProperties(fold([b, a]), "Bar"), [{ key: "K", value: "1" }]);
});

test("keys and pages compare through canonicalize, and show the first spelling the fold saw", async () => {
  const view = memory();
  await addBlock(view, "Foo", "[[STATUS]]", undefined, "f");
  const state = fold(
    [set("foo", "Status", "a"), set("FOO", " status ", "b"), set("Other", "Fresh", "c"), set("Other", "FRESH", "d")],
    view.state,
  );
  assert.deepEqual(getProperties(state, "Foo"), [{ key: "STATUS", value: "b" }]);
  assert.deepEqual(getProperties(state, "other"), [{ key: "Fresh", value: "d" }]);
  assert.equal(state.titles.get("foo"), "Foo");
});

test("a page named only by properties is a page: search finds it, and the key", () => {
  const state = fold([set("Bar", "Widget", "blue")]);
  assert.deepEqual(searchPages(state, ""), ["Bar", "Widget"]);
  assert.deepEqual(searchPages(state, "wid"), ["Widget"]);
});

test("a property names a page, never creates one: removing it unnames both", () => {
  const state = fold([set("Bar", "Widget", "blue"), removed("Bar", "Widget")]);
  assert.equal(state.properties.size, 0);
  assert.deepEqual(searchPages(state, ""), []);
  // The spelling stays, as a link's does once the link is gone.
  assert.equal(state.titles.get("widget"), "Widget");
});

test("a key that is also written on stays a page when the property goes", async () => {
  const view = memory();
  await addBlock(view, "Widget", "notes", undefined, "w");
  const state = fold([set("Bar", "Widget", "blue"), removed("Bar", "Widget")], view.state);
  assert.deepEqual(searchPages(state, ""), ["Widget"]);
});

test("removing a page's last property deletes its entry; removing one of two keeps the other", () => {
  const two = fold([set("Bar", "A", "1"), set("Bar", "B", "2")]);
  assert.deepEqual(getProperties(fold([removed("Bar", "A")], two), "Bar"), [{ key: "B", value: "2" }]);
  assert.equal(fold([removed("Bar", "A"), removed("Bar", "B")], two).properties.has("bar"), false);
});

test("removing a key the page lacks changes nothing but the spellings", () => {
  const state = fold([set("Bar", "A", "1"), set("Other", "B", "2")]);
  assert.equal(pagesFold.reduce(state, removed("bar", "b")), state);
  const named = pagesFold.reduce(state, removed("Bar", "Nothing"));
  assert.equal(named.properties, state.properties);
  assert.equal(named.titles.get("nothing"), "Nothing");
});

test("a value is a plain string: empty is kept, and a link in it names nothing", () => {
  const state = fold([set("Bar", "Empty", ""), set("Bar", "Link", "[[Gadget]]")]);
  assert.deepEqual(getProperties(state, "Bar"), [
    { key: "Empty", value: "" },
    { key: "Link", value: "[[Gadget]]" },
  ]);
  assert.equal(state.titles.has("gadget"), false);
});

test("properties list by canonicalize(key), whatever order they were set in", () => {
  const state = fold([set("P", "b", "2"), set("P", "C", "3"), set("P", "A", "1")]);
  assert.deepEqual(
    getProperties(state, "P").map(({ key }) => key),
    ["A", "b", "C"],
  );
});

test("a malformed event is skipped whole and leaves the same state", () => {
  const state = fold([set("Bar", "A", "1")]);
  const type = `${NAMESPACE}property.set`;
  const payloads: [string, unknown][] = [
    ["not an object", "Bar"],
    ["null", null],
    ["page not a string", { page: 1, key: "K", value: "v" }],
    ["page blank", { page: "  ", key: "K", value: "v" }],
    ["key not a string", { page: "Bar", key: ["K"], value: "v" }],
    ["key blank", { page: "Bar", key: "", value: "v" }],
    ["value not a string", { page: "Bar", key: "K", value: 1 }],
    ["value missing", { page: "Bar", key: "K" }],
    ["inherited fields", Object.create({ page: "Bar", key: "K", value: "v" })],
  ];
  for (const [name, payload] of payloads) {
    assert.equal(pagesFold.reduce(state, { type, v: 1, payload }), state, name);
  }
  const gone = `${NAMESPACE}property.removed`;
  assert.equal(pagesFold.reduce(state, { type: gone, v: 1, payload: { page: "Bar" } }), state);
  assert.equal(pagesFold.reduce(state, { type: gone, v: 1, payload: { page: " ", key: "A" } }), state);
});

test("an extra field folds as if it were absent", () => {
  const type = `${NAMESPACE}property.set`;
  const extra = { type, v: 1, payload: { page: "Bar", key: "K", value: "v", kind: "text" } };
  assert.deepEqual(fold([extra]), fold([set("Bar", "K", "v")]));
});

test("__proto__ is an ordinary page and an ordinary key", () => {
  const state = fold([set("__proto__", "__proto__", "x"), set("Bar", "constructor", "y")]);
  assert.deepEqual(getProperties(state, "__proto__"), [{ key: "__proto__", value: "x" }]);
  assert.deepEqual(getProperties(state, "Bar"), [{ key: "constructor", value: "y" }]);
  assert.deepEqual(getProperties(state, "toString"), []);
});

test("a newer v than this build reads is skipped by the gate", () => {
  const state = pagesFold.initial;
  assert.equal(pagesFold.reduce(state, { ...set("Bar", "K", "v"), v: 2 }), state);
});

test("the property fold leaves the state alone for a block event, and carries what it does not hold", () => {
  const state = { ...pagesFold.initial, extra: 1 };
  const block = { type: `${NAMESPACE}block.created`, payload: { page: "P", id: "b", text: "x" } };
  assert.equal(reduce(state, block), state);
  assert.equal(reduce(state, set("Bar", "K", "v")).extra, 1);
});

/** A view over a plain list of events, folded through the gate. */
function memory(): PagesView {
  let state: Pages = pagesFold.initial;
  return {
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      state = pagesFold.reduce(state, { type, v, payload });
    },
  };
}

test("predictProperties folds writes in flight over the properties a page was sent", () => {
  const sent = [{ key: "Owner", value: "Mira" }, { key: "Status", value: "doing" }];
  assert.deepEqual(
    predictProperties(sent, "Foo", [
      set("Foo", "Author", "Mira"),
      removed("Foo", "Owner"),
      set("foo", "status", "done"),
    ]),
    [
      { key: "Author", value: "Mira" },
      { key: "Status", value: "done" },
    ],
  );
});

test("predictProperties passes over other pages' writes and events that are not its own", () => {
  const sent = [{ key: "Status", value: "doing" }];
  const block = { type: `${NAMESPACE}block.edited`, payload: { id: "b", text: "x" } };
  assert.deepEqual(predictProperties(sent, "Foo", [set("Bar", "Status", "done"), block]), sent);
  assert.deepEqual(predictProperties([], "Foo", [removed("Foo", "Status")]), []);
});

test("predicting a write the properties already hold changes nothing", () => {
  const events = [set("Foo", "Author", "Mira"), removed("Foo", "Owner")];
  const once = predictProperties([{ key: "Owner", value: "Mira" }], "Foo", events);
  assert.deepEqual(predictProperties(once, "Foo", events), once);
});
