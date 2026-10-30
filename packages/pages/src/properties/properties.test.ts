/**
 * Run with: npm test
 *
 * Page properties folded through the gate, with no log around them: each
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
import type { Pages } from "../pages.ts";

const PAGE = "Mira";
const DAY = "2026-10-29";

type Event = { type: string; v: number; payload: unknown };

/** A property event of `name`, as written. */
const ev = (name: string, payload: unknown, v = 1): Event => ({
  type: `${NAMESPACE}page.property.${name}`,
  v,
  payload,
});

const set = (path: unknown, value: unknown, page: unknown = PAGE) =>
  ev("set", { page, path, value });
const unset = (path: unknown, page: unknown = PAGE) => ev("unset", { page, path });
const added = (path: unknown, item: unknown, page: unknown = PAGE) =>
  ev("item.added", { page, path, item });
const removedItem = (path: unknown, item: unknown, page: unknown = PAGE) =>
  ev("item.removed", { page, path, item });
const removed = (seen: unknown, page: unknown = PAGE) => ev("removed", { page, seen });

/** `events` folded in order, from nothing. */
function fold(...events: Event[]): Pages {
  return events.reduce((state, event) => pagesFold.reduce(state, event), pagesFold.initial);
}

/** What `path` holds on `page`, as plain data to compare. */
function at(state: Pages, path: string[], page = PAGE) {
  const { value, items } = get(state, page, path);
  return { value, items: [...items] };
}

const STATUS = ["user", "status"];

test("the table has a v for each of the five property events", () => {
  for (const name of ["set", "unset", "item.added", "item.removed", "removed"]) {
    assert.equal(HANDLES[`${NAMESPACE}page.property.${name}` as keyof typeof HANDLES], 1, name);
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
  assert.equal(getValue(fold(set(STATUS, "a"), set(STATUS, "b")), PAGE, STATUS), "b");
  assert.equal(getValue(fold(set(STATUS, "b"), set(STATUS, "a")), PAGE, STATUS), "a");
  assert.equal(getValue(fold(set(STATUS, "a"), unset(STATUS)), PAGE, STATUS), undefined);
  assert.equal(getValue(fold(unset(STATUS), set(STATUS, "a")), PAGE, STATUS), "a");

  assert.deepEqual([...getItems(fold(added(STATUS, "x"), removedItem(STATUS, "x")), PAGE, STATUS)], []);
  assert.deepEqual([...getItems(fold(removedItem(STATUS, "x"), added(STATUS, "x")), PAGE, STATUS)], ["x"]);
});

test("two writers adding different items to one path keep both, in either order", () => {
  const one = getItems(fold(added(STATUS, "a"), added(STATUS, "b")), PAGE, STATUS);
  const other = getItems(fold(added(STATUS, "b"), added(STATUS, "a")), PAGE, STATUS);
  assert.deepEqual([...one].sort(), ["a", "b"]);
  assert.deepEqual([...other].sort(), ["a", "b"]);
});

test("adding an item that is already there moves it to the end", () => {
  const state = fold(added(STATUS, "a"), added(STATUS, "b"), added(STATUS, "a"));
  assert.deepEqual([...getItems(state, PAGE, STATUS)], ["b", "a"]);
});

test("a path emptied by its last unset or item.removed is gone, and so is a page left with nothing", () => {
  const note = ["user", "status", "note"];
  const state = fold(set(note, "x"), added(STATUS, "a"));
  assert.deepEqual(children(state, PAGE, ["user"]), ["status"]);

  const emptied = fold(set(note, "x"), added(STATUS, "a"), unset(note), removedItem(STATUS, "a"));
  assert.deepEqual(list(emptied, PAGE), []);
  assert.deepEqual(children(emptied, PAGE, []), []);
  assert.equal(emptied.properties.size, 0);

  // A parent that holds nothing itself goes with the last thing under it.
  const parentless = fold(set(note, "x"), unset(note));
  assert.deepEqual(children(parentless, PAGE, ["user"]), []);
});

test("a page with properties and no blocks is still a page, under its first spelling", () => {
  const state = fold(set(["user", "mood"], "good", DAY));
  assert.deepEqual(getPages(state).map((page) => page.title), [DAY]);
  assert.deepEqual(getPages(state)[0].blocks, []);

  const spelled = fold(set(STATUS, "a", "MIRA"), set(STATUS, "b", "mira"));
  assert.equal(getPage(spelled, "mira").title, "MIRA");
  const blockLater = pagesFold.reduce(spelled, {
    type: `${NAMESPACE}block.created`,
    v: 1,
    payload: { page: "Mira", id: "b1", text: "hello" },
  });
  assert.equal(getPage(blockLater, "MIRA").title, "MIRA");
  assert.equal(getPage(blockLater, "mira").blocks.length, 1);
  // The property is still there after the block event.
  assert.equal(getValue(blockLater, "Mira", STATUS), "b");
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
    set(STATUS, "x", 7),
    set(STATUS, "x", "   "),
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
    ev("renamed", { page: PAGE, path: STATUS }),
  ]) {
    assert.equal(pagesFold.reduce(before, event), before, JSON.stringify(event.payload));
  }
});

test("the gate skips a property event with a v this build does not read", () => {
  const before = pagesFold.initial;
  assert.equal(pagesFold.reduce(before, ev("set", { page: PAGE, path: STATUS, value: "x" }, 2)), before);
});

test("__proto__ as a title, a segment or an item is an ordinary key", () => {
  const proto = "__proto__";
  const state = fold(
    set(["user", proto], "x", proto),
    added(["user", proto], proto, proto),
    set(["toString"], "y"),
  );
  assert.deepEqual(at(state, ["user", proto], proto), { value: "x", items: [proto] });
  assert.equal(getValue(state, PAGE, ["toString"]), "y");
  assert.deepEqual(children(state, proto, ["user"]), [proto]);
  assert.deepEqual(getPage(state, proto).blocks, []);
});

test("NFC and NFD spellings of one string are one segment, one value and one item", () => {
  const nfc = "Café";
  const nfd = "Café";
  const state = fold(set(["user", nfd], nfd), added(["user", nfc], nfd), added(["user", nfd], nfc));
  assert.deepEqual(at(state, ["user", nfc]), { value: nfc, items: [nfc] });
  assert.deepEqual(children(state, PAGE, ["user"]), [nfc]);
});

test("scalars keep their type, segments are trimmed, and empty strings are values", () => {
  const items = getItems(fold(added(STATUS, 1), added(STATUS, "1"), added(STATUS, true), added(STATUS, null)), PAGE, STATUS);
  assert.deepEqual([...items], [1, "1", true, null]);

  assert.deepEqual(at(fold(set(STATUS, null)), STATUS), { value: null, items: [] });
  assert.equal(list(fold(set(STATUS, null)), PAGE).length, 1);
  assert.deepEqual(list(fold(set(STATUS, null), unset(STATUS)), PAGE), []);

  const trimmed = fold(set([" user ", "\tstatus\n"], "x"));
  assert.equal(getValue(trimmed, PAGE, STATUS), "x");
  assert.equal(getValue(trimmed, PAGE, ["  user", "status  "]), "x");

  assert.deepEqual(at(fold(set(STATUS, ""), added(STATUS, "")), STATUS), { value: "", items: [""] });

  // -0 is 0, as JSON writes it, and 1.0 is 1.
  assert.deepEqual([...getItems(fold(added(STATUS, -0), added(STATUS, 0), added(STATUS, 1.0), added(STATUS, 1)), PAGE, STATUS)], [0, 1]);
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
  assert.deepEqual(list(gone, PAGE), []);
  assert.deepEqual(children(gone, PAGE, ["user"]), []);
});

test("removed leaves what the writer did not see, in either fold order", () => {
  const note = ["user", "status", "note"];
  const base = [set(STATUS, "draft"), added(STATUS, "a")];
  const removal = removed([{ path: STATUS, value: "draft", items: ["a"] }]);
  const concurrent = [set(STATUS, "done"), added(STATUS, "b"), set(note, "y")];

  for (const state of [fold(...base, ...concurrent, removal), fold(...base, removal, ...concurrent)]) {
    assert.deepEqual(at(state, STATUS), { value: "done", items: ["b"] });
    assert.equal(getValue(state, PAGE, note), "y");
  }
});

test("removed takes a seen value that is still there, null included, and leaves the value for an absent one", () => {
  assert.equal(
    getValue(fold(set(STATUS, null), removed([{ path: STATUS, value: null, items: [] }])), PAGE, STATUS),
    undefined,
  );
  // A seen `null` is not a seen "nothing": a value of "x" stays.
  assert.equal(
    getValue(fold(set(STATUS, "x"), removed([{ path: STATUS, value: null, items: [] }])), PAGE, STATUS),
    "x",
  );
  // No `value`: the writer saw no value here, so whatever is there stays.
  assert.deepEqual(
    at(fold(set(STATUS, "x"), added(STATUS, "a"), removed([{ path: STATUS, items: ["a"] }])), STATUS),
    { value: "x", items: [] },
  );
  // The seen value compares the way the fold does: NFD finds NFC, -0 finds 0.
  assert.equal(
    getValue(fold(set(STATUS, "Café"), removed([{ path: STATUS, value: "Café", items: [] }])), PAGE, STATUS),
    undefined,
  );
  assert.equal(getValue(fold(set(STATUS, 0), removed([{ path: STATUS, value: -0, items: [] }])), PAGE, STATUS), undefined);
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

  assert.deepEqual(children(state, PAGE, []), ["app", "user"]);
  assert.deepEqual(children(state, PAGE, ["user"]), ["foo", "foobar", "～", "\u{1F600}"]);
  assert.deepEqual(children(state, PAGE, ["user", "foo"]), ["deep", "list"]);
  assert.deepEqual(children(state, PAGE, ["user", "foo", "deep"]), ["er"]);
  assert.deepEqual(children(state, PAGE, ["user", "foo", "deep", "er"]), []);

  // A scope that holds something itself comes first, then what is under it;
  // ["foo"] is not a prefix of ["foobar"].
  assert.deepEqual(
    list(state, PAGE, ["user", "foo"]).map((it) => showPath(it.path)),
    ["user/foo", "user/foo/deep/er", "user/foo/list"],
  );
  assert.deepEqual(
    list(state, PAGE).map((it) => showPath(it.path)),
    ["app/cover", "user/foo", "user/foo/deep/er", "user/foo/list", "user/foobar", "user/～", "user/\u{1F600}"],
  );
  // Only paths that hold something: "user/foo/deep" is in neither list.
  assert.equal(get(state, PAGE, ["user", "foo", "deep"]).value, undefined);
  // The root holds nothing.
  assert.deepEqual(at(state, []), { value: undefined, items: [] });
  // A page with nothing, and a scope that can't be a path, read as empty.
  assert.deepEqual(list(state, "Nobody"), []);
  assert.deepEqual(list(state, PAGE, ["  "]), []);
  assert.deepEqual(children(state, PAGE, ["nothing", "here"]), []);
});

test("reads are snapshots, and the fold never changes the state it is handed", () => {
  const state = fold(set(STATUS, "draft"), added(STATUS, "a"));
  const read = get(state, PAGE, STATUS);
  read.path.push("changed");
  (read.items as Set<unknown>).add("b");
  assert.deepEqual(at(state, STATUS), { value: "draft", items: ["a"] });

  const page = state.properties.get("mira");
  const snapshot = structuredClone(state.properties);
  pagesFold.reduce(state, set(STATUS, "done"));
  pagesFold.reduce(state, added(STATUS, "c"));
  pagesFold.reduce(state, removed([{ path: STATUS, value: "draft", items: ["a"] }]));
  assert.equal(state.properties.get("mira"), page);
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
