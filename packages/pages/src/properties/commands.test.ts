/**
 * Run with: npm test
 *
 * The property commands against a `PagesView` whose `dispatch` folds into a
 * held state, with no app and no ledger (#133).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addBlock,
  addPropertyItem,
  deleteBlock,
  get,
  HANDLES,
  list,
  NAMESPACE,
  pagesFold,
  propertyItemAdded,
  propertyItemRemoved,
  propertyRemoved,
  propertySet,
  propertyUnset,
  removeProperty,
  removePropertyItem,
  renameProperty,
  setProperty,
  unsetProperty,
} from "../pages.ts";
import type { Pages, PagesView, Target } from "../pages.ts";

const MIRA: Target = { kind: "page", title: "Mira" };
const STATUS = ["user", "status"];

type Written = { v: number; type: string; payload: unknown };

/** A view over a held state; `written` is every event dispatched, in order. */
function view(state: Pages = pagesFold.initial) {
  const written: Written[] = [];
  const it: PagesView & { written: Written[] } = {
    written,
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      written.push({ v, type, payload });
      state = pagesFold.reduce(state, { v, type, payload });
    },
  };
  return it;
}

/** A view whose dispatch fails after `limit` events: a crash midway. */
function crashing(limit: number, state: Pages = pagesFold.initial) {
  const inner = view(state);
  return {
    ...inner,
    get state() {
      return inner.state;
    },
    async dispatch(v: number, type: keyof typeof HANDLES, payload: unknown) {
      if (inner.written.length >= limit) throw new Error("crashed");
      await inner.dispatch(v, type, payload);
    },
  };
}

const at = (state: Pages, path: string[], of: Target = MIRA) => {
  const { value, items } = get(state, of, path);
  return { value, items: [...items] };
};

test("each builder writes v from HANDLES and the payload the schema gives", () => {
  const cases = [
    [propertySet(MIRA, STATUS, "draft"), "set", { of: MIRA, path: STATUS, value: "draft" }],
    [propertyUnset(MIRA, STATUS), "unset", { of: MIRA, path: STATUS }],
    [propertyItemAdded(MIRA, STATUS, 1), "item.added", { of: MIRA, path: STATUS, item: 1 }],
    [propertyItemRemoved(MIRA, STATUS, 1), "item.removed", { of: MIRA, path: STATUS, item: 1 }],
    [
      propertyRemoved(MIRA, [{ path: STATUS, items: [1] }]),
      "removed",
      { of: MIRA, seen: [{ path: STATUS, items: [1] }] },
    ],
  ] as const;
  for (const [event, name, payload] of cases) {
    const type = `${NAMESPACE}property.${name}`;
    assert.equal(event.type, type);
    assert.equal(event.v, HANDLES[type as keyof typeof HANDLES]);
    assert.deepEqual(event.payload, payload);
  }
});

test("each builder folds to what it means", () => {
  const fold = (...events: Written[]) =>
    events.reduce((state, event) => pagesFold.reduce(state, event), pagesFold.initial);
  const set = fold(propertySet(MIRA, STATUS, "draft"), propertyItemAdded(MIRA, STATUS, "a"));
  assert.deepEqual(at(set, STATUS), { value: "draft", items: ["a"] });
  assert.deepEqual(at(fold(propertySet(MIRA, STATUS, "x"), propertyUnset(MIRA, STATUS)), STATUS), {
    value: undefined,
    items: [],
  });
  const removed = fold(
    propertyItemAdded(MIRA, STATUS, "a"),
    propertyItemAdded(MIRA, STATUS, "b"),
    propertyItemRemoved(MIRA, STATUS, "a"),
  );
  assert.deepEqual(at(removed, STATUS), { value: undefined, items: ["b"] });
  const gone = fold(
    propertySet(MIRA, STATUS, "x"),
    propertyRemoved(MIRA, [{ path: STATUS, value: "x", items: [] }]),
  );
  assert.deepEqual(list(gone, MIRA), []);
});

test("the four single commands write and fold", async () => {
  const v = view();
  await setProperty(v, MIRA, STATUS, "draft");
  await addPropertyItem(v, MIRA, STATUS, "a");
  assert.deepEqual(at(v.state, STATUS), { value: "draft", items: ["a"] });
  await unsetProperty(v, MIRA, STATUS);
  await removePropertyItem(v, MIRA, STATUS, "a");
  assert.deepEqual(list(v.state, MIRA), []);
  assert.equal(v.written.length, 4);
});

test("null and an empty string are written as values", async () => {
  const v = view();
  await setProperty(v, MIRA, ["a"], null);
  await setProperty(v, MIRA, ["b"], "");
  await addPropertyItem(v, MIRA, ["c"], null);
  assert.equal(v.written.length, 3);
  assert.equal(get(v.state, MIRA, ["a"]).value, null);
  assert.equal(get(v.state, MIRA, ["b"]).value, "");
  assert.deepEqual(at(v.state, ["c"]).items, [null]);
});

test("a malformed path, value or item is refused and writes nothing", async () => {
  const v = view();
  const bad: Array<() => Promise<void>> = [
    () => setProperty(v, MIRA, STATUS, NaN),
    () => setProperty(v, MIRA, STATUS, Infinity),
    () => setProperty(v, MIRA, STATUS, -Infinity),
    () => setProperty(v, MIRA, STATUS, undefined as never),
    () => setProperty(v, MIRA, STATUS, {} as never),
    () => setProperty(v, MIRA, ["   "], "x"),
    () => setProperty(v, MIRA, [], "x"),
    () => setProperty(v, MIRA, [1] as never, "x"),
    () => setProperty(v, { kind: "page", title: "  " }, STATUS, "x"),
    () => unsetProperty(v, MIRA, ["user", ""]),
    () => addPropertyItem(v, MIRA, STATUS, NaN),
    () => removePropertyItem(v, MIRA, STATUS, Infinity),
    () => removeProperty(v, MIRA, ["   "]),
    () => renameProperty(v, MIRA, STATUS, ["  "]),
    () => renameProperty(v, MIRA, [], STATUS),
  ];
  for (const command of bad) await assert.rejects(command, /Not a valid property/);
  assert.deepEqual(v.written, []);
});

test("every command refuses a block the state lacks, and writes nothing", async () => {
  const v = view();
  await addBlock(v, "Mira", "first", undefined, "b1");
  await deleteBlock(v, "b1");
  const before = v.written.length;
  for (const id of ["nope", "b1"]) {
    const of: Target = { kind: "block", id };
    const commands = [
      () => setProperty(v, of, STATUS, "x"),
      () => unsetProperty(v, of, STATUS),
      () => addPropertyItem(v, of, STATUS, "x"),
      () => removePropertyItem(v, of, STATUS, "x"),
      () => removeProperty(v, of, STATUS),
      () => renameProperty(v, of, STATUS, ["user", "state"]),
    ];
    for (const command of commands) await assert.rejects(command, /No such block/);
  }
  assert.equal(v.written.length, before);
});

test("a block that exists takes properties", async () => {
  const v = view();
  await addBlock(v, "Mira", "first", undefined, "b1");
  const b1: Target = { kind: "block", id: "b1" };
  await setProperty(v, b1, STATUS, "done");
  assert.equal(get(v.state, b1, STATUS).value, "done");
});

test("a write that changes nothing writes nothing", async () => {
  const v = view();
  await setProperty(v, MIRA, STATUS, "Café");
  await addPropertyItem(v, MIRA, STATUS, "Café");
  const before = v.written.length;

  const nfd = "Café";
  await setProperty(v, MIRA, STATUS, "Café");
  await setProperty(v, MIRA, [" user ", "status"], nfd);
  await addPropertyItem(v, MIRA, STATUS, "Café");
  await addPropertyItem(v, MIRA, ["user", " status"], nfd);
  await removePropertyItem(v, MIRA, STATUS, "absent");
  await unsetProperty(v, MIRA, ["user", "other"]);
  await removeProperty(v, MIRA, ["nothing"]);
  await renameProperty(v, MIRA, ["nothing"], ["else"]);
  // A page nothing has named: a no-op still, though the fold would spell it.
  await unsetProperty(v, { kind: "page", title: "Unnamed" }, STATUS);
  assert.equal(v.written.length, before);
});

test("a different scalar of the same text is a change", async () => {
  const v = view();
  await setProperty(v, MIRA, STATUS, "1");
  await setProperty(v, MIRA, STATUS, 1);
  await addPropertyItem(v, MIRA, STATUS, "1");
  await addPropertyItem(v, MIRA, STATUS, 1);
  assert.equal(v.written.length, 4);
});

test("removeProperty lists what the state holds at and under the path", async () => {
  const v = view();
  await setProperty(v, MIRA, ["app", "cover"], "sky");
  await setProperty(v, MIRA, ["app", "cover", "position"], 0.35);
  await addPropertyItem(v, MIRA, ["app", "cover"], "x");
  await setProperty(v, MIRA, ["app", "coverage"], "kept");
  await setProperty(v, MIRA, ["app", "cover", "flag"], null);
  const before = v.written.length;

  await removeProperty(v, MIRA, ["app", "cover"]);
  assert.equal(v.written.length, before + 1);
  assert.deepEqual(v.written.at(-1)?.payload, {
    of: MIRA,
    seen: [
      { path: ["app", "cover"], value: "sky", items: ["x"] },
      { path: ["app", "cover", "flag"], value: null, items: [] },
      { path: ["app", "cover", "position"], value: 0.35, items: [] },
    ],
  });
  assert.deepEqual(list(v.state, MIRA, ["app", "cover"]), []);
  assert.equal(get(v.state, MIRA, ["app", "coverage"]).value, "kept");
});

test("renameProperty copies at and under from, then removes from", async () => {
  const v = view();
  await setProperty(v, MIRA, ["user", "tags"], "main");
  await addPropertyItem(v, MIRA, ["user", "tags"], "b");
  await addPropertyItem(v, MIRA, ["user", "tags"], "a");
  await setProperty(v, MIRA, ["user", "tags", "colour"], "red");
  const before = v.written.length;

  await renameProperty(v, MIRA, ["user", "tags"], ["user", "labels"]);
  const names = v.written.slice(before).map((it) => it.type.slice(NAMESPACE.length));
  assert.deepEqual(names, ["property.set", "property.item.added", "property.item.added", "property.set", "property.removed"]);
  assert.deepEqual(list(v.state, MIRA, ["user", "tags"]), []);
  assert.deepEqual(at(v.state, ["user", "labels"]), { value: "main", items: ["b", "a"] });
  assert.equal(get(v.state, MIRA, ["user", "labels", "colour"]).value, "red");
});

test("renameProperty refuses a to that already holds something", async () => {
  const v = view();
  await setProperty(v, MIRA, ["a"], 1);
  await setProperty(v, MIRA, ["b", "c"], 2);
  const before = v.written.length;
  await assert.rejects(() => renameProperty(v, MIRA, ["a"], ["b"]), /already exists/);
  await assert.rejects(() => renameProperty(v, MIRA, ["a"], [" a "]), /already exists/);
  assert.equal(v.written.length, before);
});

test("a rename that crashes after its additions leaves both keys", async () => {
  const setup = view();
  await setProperty(setup, MIRA, ["a"], 1);
  await addPropertyItem(setup, MIRA, ["a"], "x");
  const v = crashing(2, setup.state);
  await assert.rejects(() => renameProperty(v, MIRA, ["a"], ["b"]), /crashed/);
  assert.deepEqual(at(v.state, ["a"]), { value: 1, items: ["x"] });
  assert.deepEqual(at(v.state, ["b"]), { value: 1, items: ["x"] });
});
