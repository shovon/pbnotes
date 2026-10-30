/**
 * Run with: npm test
 *
 * Properties folded through the gate, with no log around them: each
 * event is `{ type, v, payload }`, which is all the fold reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  children,
  get,
  getItems,
  getPage,
  getPages,
  getValue,
  HANDLES,
  list,
  NAMESPACE,
  pagesFold,
  path,
  showPath,
} from "../pages.ts";
import type { Pages, Target } from "../pages.ts";

const PAGE = "Mira";

/** A page as a target. `unknown`, so a test can hand it a title the fold refuses. */
const onPage = (title: unknown) => ({ kind: "page", title });
const MIRA: Target = { kind: "page", title: PAGE };
const DAY = "2026-10-29";

type Event = { type: string; v: number; payload: unknown };

/** A property event of `name`, as written. */
const ev = (name: string, payload: unknown, v = 1): Event => ({
  type: `${NAMESPACE}property.${name}`,
  v,
  payload,
});

const set = (path: unknown, value: unknown, of: unknown = MIRA) =>
  ev("set", { of, path, value });
const unset = (path: unknown, of: unknown = MIRA) => ev("unset", { of, path });
const added = (path: unknown, item: unknown, of: unknown = MIRA) =>
  ev("item.added", { of, path, item });
const removedItem = (path: unknown, item: unknown, of: unknown = MIRA) =>
  ev("item.removed", { of, path, item });
const removed = (seen: unknown, of: unknown = MIRA) => ev("removed", { of, seen });

/** `events` folded in order, from nothing. */
function fold(...events: Event[]): Pages {
  return events.reduce((state, event) => pagesFold.reduce(state, event), pagesFold.initial);
}

/** What `path` holds on `of`, as plain data to compare. */
function at(state: Pages, path: string[], of: Target = MIRA) {
  const { value, items } = get(state, of, path);
  return { value, items: [...items] };
}

const STATUS = ["user", "status"];

test("the table has a v for each of the five property events", () => {
  for (const name of ["set", "unset", "item.added", "item.removed", "removed"]) {
    assert.equal(HANDLES[`${NAMESPACE}property.${name}` as keyof typeof HANDLES], 1, name);
  }
});

test("set and unset touch the value, and leave the items alone", () => {
  const state = fold(added(STATUS, "a"), set(STATUS, "draft"));
  assert.deepEqual(at(state, STATUS), { value: "draft", items: ["a"] });
  assert.deepEqual(at(fold(added(STATUS, "a"), set(STATUS, "draft"), unset(STATUS)), STATUS), {
    value: undefined,
    items: ["a"],
  });
});

test("item.added and item.removed touch the items, and leave the value alone", () => {
  const state = fold(set(STATUS, "draft"), added(STATUS, "a"), added(STATUS, "b"));
  assert.deepEqual(at(state, STATUS), { value: "draft", items: ["a", "b"] });
  assert.deepEqual(
    at(pagesFold.reduce(state, removedItem(STATUS, "a")), STATUS),
    { value: "draft", items: ["b"] },
  );
});

test("the later write in fold order wins, for the value and for each item", () => {
  assert.equal(getValue(fold(set(STATUS, "a"), set(STATUS, "b")), MIRA, STATUS), "b");
  assert.equal(getValue(fold(set(STATUS, "b"), set(STATUS, "a")), MIRA, STATUS), "a");
  assert.equal(getValue(fold(set(STATUS, "a"), unset(STATUS)), MIRA, STATUS), undefined);
  assert.equal(getValue(fold(unset(STATUS), set(STATUS, "a")), MIRA, STATUS), "a");

  assert.deepEqual([...getItems(fold(added(STATUS, "x"), removedItem(STATUS, "x")), MIRA, STATUS)], []);
  assert.deepEqual([...getItems(fold(removedItem(STATUS, "x"), added(STATUS, "x")), MIRA, STATUS)], ["x"]);
});

test("two writers adding different items to one path keep both, in either order", () => {
  const one = getItems(fold(added(STATUS, "a"), added(STATUS, "b")), MIRA, STATUS);
  const other = getItems(fold(added(STATUS, "b"), added(STATUS, "a")), MIRA, STATUS);
  assert.deepEqual([...one].sort(), ["a", "b"]);
  assert.deepEqual([...other].sort(), ["a", "b"]);
});

test("adding an item that is already there moves it to the end", () => {
  const state = fold(added(STATUS, "a"), added(STATUS, "b"), added(STATUS, "a"));
  assert.deepEqual([...getItems(state, MIRA, STATUS)], ["b", "a"]);
});

test("a path emptied by its last unset or item.removed is gone, and so is a page left with nothing", () => {
  const note = ["user", "status", "note"];
  const state = fold(set(note, "x"), added(STATUS, "a"));
  assert.deepEqual(children(state, MIRA, ["user"]), ["status"]);

  const emptied = fold(set(note, "x"), added(STATUS, "a"), unset(note), removedItem(STATUS, "a"));
  assert.deepEqual(list(emptied, MIRA), []);
  assert.deepEqual(children(emptied, MIRA, []), []);
  assert.equal(emptied.properties.size, 0);

  // A parent that holds nothing itself goes with the last thing under it.
  const parentless = fold(set(note, "x"), unset(note));
  assert.deepEqual(children(parentless, MIRA, ["user"]), []);
});

test("a page with properties and no blocks is still a page, under its first spelling", () => {
  const state = fold(set(["user", "mood"], "good", onPage(DAY)));
  assert.deepEqual(getPages(state).map((page) => page.title), [DAY]);
  assert.deepEqual(getPages(state)[0].blocks, []);

  const spelled = fold(set(STATUS, "a", onPage("MIRA")), set(STATUS, "b", onPage("mira")));
  assert.equal(getPage(spelled, "mira").title, "MIRA");
  const blockLater = pagesFold.reduce(spelled, {
    type: `${NAMESPACE}block.created`,
    v: 1,
    payload: { page: "Mira", id: "b1", text: "hello" },
  });
  assert.equal(getPage(blockLater, "MIRA").title, "MIRA");
  assert.equal(getPage(blockLater, "mira").blocks.length, 1);
  // The property is still there after the block event.
  assert.equal(getValue(blockLater, MIRA, STATUS), "b");
});

test("a malformed payload is skipped whole and not applied in part", () => {
  const before = fold(set(STATUS, "kept"));
  for (const event of [
    set([], "x"),
    set("user/status", "x"),
    set(["user", 3], "x"),
    set(["user", ""], "x"),
    set(["user", "   "], "x"),
    set(STATUS, undefined),
    set(STATUS, Number.NaN),
    set(STATUS, Number.POSITIVE_INFINITY),
    set(STATUS, { nested: true }),
    set(STATUS, ["a"]),
    set(STATUS, "x", onPage(7)),
    set(STATUS, "x", onPage("   ")),
    added(STATUS, undefined),
    ev("set", null),
    ev("set", "not an object"),
    ev("set", { path: STATUS, value: "x" }),
    removed([]),
    removed("nope"),
    removed([{ path: STATUS, items: ["a"] }, { path: [], items: [] }]),
    removed([{ path: STATUS }]),
    removed([{ path: STATUS, items: [Number.NaN] }]),
    removed([{ path: STATUS, value: Number.NaN, items: [] }]),
    ev("renamed", { of: MIRA, path: STATUS }),
  ]) {
    assert.equal(pagesFold.reduce(before, event), before, JSON.stringify(event.payload));
  }
});

test("the gate skips a property event with a v this build does not read", () => {
  const before = pagesFold.initial;
  assert.equal(pagesFold.reduce(before, ev("set", { of: MIRA, path: STATUS, value: "x" }, 2)), before);
});

test("__proto__ as a title, a segment or an item is an ordinary key", () => {
  const proto = "__proto__";
  const state = fold(
    set(["user", proto], "x", onPage(proto)),
    added(["user", proto], proto, onPage(proto)),
    set(["toString"], "y"),
  );
  assert.deepEqual(at(state, ["user", proto], { kind: "page", title: proto }), { value: "x", items: [proto] });
  assert.equal(getValue(state, MIRA, ["toString"]), "y");
  assert.deepEqual(children(state, { kind: "page", title: proto }, ["user"]), [proto]);
  assert.deepEqual(getPage(state, proto).blocks, []);
});

test("NFC and NFD spellings of one string are one segment, one value and one item", () => {
  const nfc = "Café";
  const nfd = "Café";
  const state = fold(set(["user", nfd], nfd), added(["user", nfc], nfd), added(["user", nfd], nfc));
  assert.deepEqual(at(state, ["user", nfc]), { value: nfc, items: [nfc] });
  assert.deepEqual(children(state, MIRA, ["user"]), [nfc]);
});

test("scalars keep their type, segments are trimmed, and empty strings are values", () => {
  const items = getItems(fold(added(STATUS, 1), added(STATUS, "1"), added(STATUS, true), added(STATUS, null)), MIRA, STATUS);
  assert.deepEqual([...items], [1, "1", true, null]);

  assert.deepEqual(at(fold(set(STATUS, null)), STATUS), { value: null, items: [] });
  assert.equal(list(fold(set(STATUS, null)), MIRA).length, 1);
  assert.deepEqual(list(fold(set(STATUS, null), unset(STATUS)), MIRA), []);

  const trimmed = fold(set([" user ", "\tstatus\n"], "x"));
  assert.equal(getValue(trimmed, MIRA, STATUS), "x");
  assert.equal(getValue(trimmed, MIRA, ["  user", "status  "]), "x");

  assert.deepEqual(at(fold(set(STATUS, ""), added(STATUS, "")), STATUS), { value: "", items: [""] });

  // -0 is 0, as JSON writes it, and 1.0 is 1.
  assert.deepEqual([...getItems(fold(added(STATUS, -0), added(STATUS, 0), added(STATUS, 1.0), added(STATUS, 1)), MIRA, STATUS)], [0, 1]);
});

test("removed clears what it lists, at a path and under it", () => {
  const note = ["user", "status", "note"];
  const state = fold(set(STATUS, "draft"), added(STATUS, "a"), set(note, "x"));
  const gone = pagesFold.reduce(
    state,
    removed([
      { path: STATUS, value: "draft", items: ["a"] },
      { path: note, value: "x", items: [] },
    ]),
  );
  assert.deepEqual(list(gone, MIRA), []);
  assert.deepEqual(children(gone, MIRA, ["user"]), []);
});

test("removed leaves what the writer did not see, in either fold order", () => {
  const note = ["user", "status", "note"];
  const base = [set(STATUS, "draft"), added(STATUS, "a")];
  const removal = removed([{ path: STATUS, value: "draft", items: ["a"] }]);
  const concurrent = [set(STATUS, "done"), added(STATUS, "b"), set(note, "y")];

  for (const state of [fold(...base, ...concurrent, removal), fold(...base, removal, ...concurrent)]) {
    assert.deepEqual(at(state, STATUS), { value: "done", items: ["b"] });
    assert.equal(getValue(state, MIRA, note), "y");
  }
});

test("removed takes a seen value that is still there, null included, and leaves the value for an absent one", () => {
  assert.equal(
    getValue(fold(set(STATUS, null), removed([{ path: STATUS, value: null, items: [] }])), MIRA, STATUS),
    undefined,
  );
  // A seen `null` is not a seen "nothing": a value of "x" stays.
  assert.equal(
    getValue(fold(set(STATUS, "x"), removed([{ path: STATUS, value: null, items: [] }])), MIRA, STATUS),
    "x",
  );
  // No `value`: the writer saw no value here, so whatever is there stays.
  assert.deepEqual(
    at(fold(set(STATUS, "x"), added(STATUS, "a"), removed([{ path: STATUS, items: ["a"] }])), STATUS),
    { value: "x", items: [] },
  );
  // The seen value compares the way the fold does: NFD finds NFC, -0 finds 0.
  assert.equal(
    getValue(fold(set(STATUS, "Café"), removed([{ path: STATUS, value: "Café", items: [] }])), MIRA, STATUS),
    undefined,
  );
  assert.equal(getValue(fold(set(STATUS, 0), removed([{ path: STATUS, value: -0, items: [] }])), MIRA, STATUS), undefined);
});

test("list and children read the tree, sorted by codepoint", () => {
  const state = fold(
    set(["user", "foobar"], 2),
    set(["user", "foo"], 1),
    set(["user", "foo", "deep", "er"], 3),
    added(["user", "foo", "list"], "i"),
    set(["app", "cover"], "x"),
    // U+FF5E sorts after U+1F600 by UTF-16 unit, before it by codepoint.
    set(["user", "\u{1F600}"], "smile"),
    set(["user", "～"], "tilde"),
  );

  assert.deepEqual(children(state, MIRA, []), ["app", "user"]);
  assert.deepEqual(children(state, MIRA, ["user"]), ["foo", "foobar", "～", "\u{1F600}"]);
  assert.deepEqual(children(state, MIRA, ["user", "foo"]), ["deep", "list"]);
  assert.deepEqual(children(state, MIRA, ["user", "foo", "deep"]), ["er"]);
  assert.deepEqual(children(state, MIRA, ["user", "foo", "deep", "er"]), []);

  // A scope that holds something itself comes first, then what is under it;
  // ["foo"] is not a prefix of ["foobar"].
  assert.deepEqual(
    list(state, MIRA, ["user", "foo"]).map((it) => showPath(it.path)),
    ["user/foo", "user/foo/deep/er", "user/foo/list"],
  );
  assert.deepEqual(
    list(state, MIRA).map((it) => showPath(it.path)),
    ["app/cover", "user/foo", "user/foo/deep/er", "user/foo/list", "user/foobar", "user/～", "user/\u{1F600}"],
  );
  // Only paths that hold something: "user/foo/deep" is in neither list.
  assert.equal(get(state, MIRA, ["user", "foo", "deep"]).value, undefined);
  // The root holds nothing.
  assert.deepEqual(at(state, []), { value: undefined, items: [] });
  // A page with nothing, and a scope that can't be a path, read as empty.
  assert.deepEqual(list(state, { kind: "page", title: "Nobody" }), []);
  assert.deepEqual(list(state, MIRA, ["  "]), []);
  assert.deepEqual(children(state, MIRA, ["nothing", "here"]), []);
});

test("reads are snapshots, and the fold never changes the state it is handed", () => {
  const state = fold(set(STATUS, "draft"), added(STATUS, "a"));
  const read = get(state, MIRA, STATUS);
  read.path.push("changed");
  (read.items as Set<unknown>).add("b");
  assert.deepEqual(at(state, STATUS), { value: "draft", items: ["a"] });

  const page = state.properties.get("page")?.get("mira");
  const snapshot = structuredClone(state.properties);
  pagesFold.reduce(state, set(STATUS, "done"));
  pagesFold.reduce(state, added(STATUS, "c"));
  pagesFold.reduce(state, removed([{ path: STATUS, value: "draft", items: ["a"] }]));
  assert.equal(state.properties.get("page")?.get("mira"), page);
  assert.deepEqual(state.properties, snapshot);
});

test("an event that changes nothing, and one that is not a property event, hand back the same state", () => {
  const state = fold(set(STATUS, "draft"));
  assert.equal(pagesFold.reduce(state, unset(["user", "other"])), state);
  assert.equal(pagesFold.reduce(state, removedItem(STATUS, "absent")), state);
  assert.equal(pagesFold.reduce(state, removed([{ path: STATUS, value: "other", items: [] }])), state);
  const block = pagesFold.reduce(state, {
    type: `${NAMESPACE}block.edited`,
    v: 2,
    payload: { id: "nope", text: "x" },
  });
  assert.equal(block, state);
});

test("path and showPath turn text into a path and back", () => {
  assert.deepEqual(path("a/b/c"), ["a", "b", "c"]);
  assert.equal(showPath(["a", "b", "c"]), "a/b/c");
});

// ── Targets (#155) ──────────────────────────────────────────────────────────

/** A block event of `name`, as written. */
const block = (name: string, payload: unknown, v = 1): Event => ({
  type: `${NAMESPACE}block.${name}`,
  v,
  payload,
});
const created = (id: string, page = PAGE) => block("created", { page, id, text: id });
const deleted = (id: string) => block("deleted", { id }, 2);
const indented = (id: string, parent: string) => block("indented", { id, parent }, 2);

const B1: Target = { kind: "block", id: "b1" };
const B2: Target = { kind: "block", id: "b2" };

test("a target that is missing, unknown or lacks its own field is skipped whole", () => {
  const before = fold(created("b1"), set(STATUS, "kept"));
  for (const of of [
    undefined,
    null,
    "Mira",
    { page: PAGE },
    { kind: "pages", title: PAGE },
    { kind: "project", id: "p1" },
    { kind: "page", id: PAGE },
    { kind: "page", title: "" },
    { kind: "block", title: "b1" },
    { kind: "block", id: "" },
    { kind: "block", id: 1 },
  ]) {
    // Built by hand: `set` would read an `of` of undefined as its default.
    const event = ev("set", { of, path: STATUS, value: "x" });
    assert.equal(pagesFold.reduce(before, event), before, String(JSON.stringify(of)));
  }
});

test("the old page.property names are not read", () => {
  const before = fold();
  const old = { type: `${NAMESPACE}page.property.set`, v: 1, payload: { page: PAGE, path: STATUS, value: "x" } };
  assert.equal(pagesFold.reduce(before, old), before);
});

test("a field a kind does not read is ignored", () => {
  const state = fold(created("b1"), set(STATUS, "x", { kind: "block", id: "b1", title: "other" }));
  assert.equal(getValue(state, B1, STATUS), "x");
});

test("a block takes the same events as a page, and keeps its own properties", () => {
  const state = fold(
    created("b1"),
    set(STATUS, "draft", B1),
    added(STATUS, "a", B1),
    added(STATUS, "b", B1),
    removedItem(STATUS, "a", B1),
    set(["user", "due"], "2026-11-01", B1),
    unset(["user", "due"], B1),
  );
  assert.deepEqual(at(state, STATUS, B1), { value: "draft", items: ["b"] });
  assert.deepEqual(list(state, B1).map((it) => showPath(it.path)), ["user/status"]);
  // The page the block is on has none of them.
  assert.deepEqual(list(state, MIRA), []);

  const gone = pagesFold.reduce(state, removed([{ path: STATUS, value: "draft", items: ["b"] }], B1));
  assert.deepEqual(list(gone, B1), []);
  assert.equal(gone.properties.size, 0);
});

test("a page and a block named by the same string are separate", () => {
  const state = fold(created("b1"), set(STATUS, "page", onPage("b1")), set(STATUS, "block", B1));
  assert.equal(getValue(state, { kind: "page", title: "b1" }, STATUS), "page");
  assert.equal(getValue(state, B1, STATUS), "block");
});

test("a block target spells no title, and does not make its id a page", () => {
  const state = fold(created("b1"), set(STATUS, "x", B1));
  assert.equal(state.titles.has("b1"), false);
  assert.deepEqual(getPages(fold(created("b1", DAY), set(STATUS, "x", B1))).map((it) => it.title), [DAY]);
});

test("a property of a block the fold lacks is dropped, before its creation and after its deletion", () => {
  const early = fold(set(STATUS, "x", B1), created("b1"));
  assert.deepEqual(list(early, B1), []);
  assert.equal(early.properties.size, 0);

  const late = fold(created("b1"), deleted("b1"), set(STATUS, "x", B1));
  assert.deepEqual(list(late, B1), []);
  assert.equal(late.properties.size, 0);
});

test("a deleted block takes its properties, and its subtree's, and leaves everything else", () => {
  const before = fold(
    created("b1"),
    created("b2"),
    created("b3"),
    indented("b2", "b1"),
    set(STATUS, "parent", B1),
    set(STATUS, "child", B2),
    set(STATUS, "sibling", { kind: "block", id: "b3" }),
    set(STATUS, "page"),
  );
  const state = pagesFold.reduce(before, deleted("b1"));
  assert.deepEqual(list(state, B1), []);
  assert.deepEqual(list(state, B2), []);
  assert.equal(getValue(state, { kind: "block", id: "b3" }, STATUS), "sibling");
  assert.equal(getValue(state, MIRA, STATUS), "page");
  // The state it was handed still has them: earlier states are checkpoints.
  assert.equal(getValue(before, B2, STATUS), "child");
});

test("deleting a block with no properties leaves the properties map as it was", () => {
  const before = fold(created("b1"), created("b2"), set(STATUS, "x", B2));
  assert.equal(pagesFold.reduce(before, deleted("b1")).properties, before.properties);
});

test("a block's properties follow it to wherever it moves", () => {
  const state = fold(created("b1"), created("b2"), set(STATUS, "x", B2), indented("b2", "b1"));
  assert.equal(getValue(state, B2, STATUS), "x");
});

test("setting the value a path already has hands back the same state", () => {
  const state = fold(set(STATUS, "Café"));
  assert.equal(pagesFold.reduce(state, set(STATUS, "Café")), state);
  assert.notEqual(pagesFold.reduce(state, set(STATUS, 1)), state);
});
