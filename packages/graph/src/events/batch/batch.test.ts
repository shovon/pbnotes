/**
 * Run with: npm test
 *
 * The batch on its own, then through the graph's gate: the fold that decides
 * which events it reads. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { all, batch, each, unbatch } from "./batch.ts";
import {
  blockCreated,
  blockEdited,
  getPage,
  getProperties,
  graphFold,
  HANDLES,
  NAMESPACE,
  predict,
  predictProperties,
  propertyRemoved,
  propertySet,
} from "../../graph.ts";
import type { Graph } from "../../graph.ts";
import { get } from "../../immutable/immutable.ts";

const BATCH = `${NAMESPACE}batch`;

/** `events` folded through the gate, from empty. */
function fold(...events: { type: string; v: number; at?: string; payload: unknown }[]): Graph {
  return events.reduce(graphFold.reduce, graphFold.initial);
}

/** A batch event holding `events` as written, with no checks: what another writer might put on disk. */
function raw(events: unknown, v = 1) {
  return { type: BATCH, v, payload: { events } };
}

// ── The module alone ────────────────────────────────────────────────────────

test("batch holds its events in order, each as { type, v, payload }", () => {
  const set = propertySet("Foo", "Owner", "Mira");
  const built = batch([set, propertyRemoved("Foo", "Old")]);
  assert.equal(built.type, BATCH);
  assert.equal(built.v, HANDLES[BATCH as keyof typeof HANDLES]);
  assert.deepEqual(built.payload.events, [
    { type: set.type, v: set.v, payload: set.payload },
    { type: `${NAMESPACE}property.removed`, v: 1, payload: { page: "Foo", key: "Old" } },
  ]);
});

test("batch refuses no events and a batch inside a batch", () => {
  assert.throws(() => batch([]), /at least one/);
  assert.throws(() => batch([batch([propertySet("Foo", "a", "b")])]), /cannot hold a batch/);
});

test("unbatch reads what batch writes, and only a well-formed batch", () => {
  const built = batch([propertySet("Foo", "a", "b")]);
  assert.deepEqual(unbatch(built), built.payload.events);
  assert.equal(unbatch(propertySet("Foo", "a", "b")), undefined);
  assert.equal(unbatch({ type: BATCH, payload: null }), undefined);
  assert.equal(unbatch({ type: BATCH, payload: {} }), undefined);
  assert.equal(unbatch(raw([])), undefined);
  assert.equal(unbatch(raw("nope")), undefined);
  assert.equal(unbatch(raw([{ type: "x", v: "1", payload: {} }])), undefined);
  assert.equal(unbatch(raw([{ type: "x", v: 1 }])), undefined);
  assert.equal(unbatch(raw([null])), undefined);
  assert.equal(unbatch(raw([built])), undefined);
});

test("unbatch ignores fields beyond { type, v, payload }", () => {
  assert.deepEqual(unbatch(raw([{ type: "x", v: 1, payload: 2, extra: true }])), [
    { type: "x", v: 1, payload: 2 },
  ]);
});

test("each puts a batch's events in its place, and passes everything else through", () => {
  const a = propertySet("Foo", "a", "1");
  const b = propertySet("Foo", "b", "2");
  const c = propertySet("Foo", "c", "3");
  const malformed = raw([]);
  assert.deepEqual(
    [...each([a, batch([b, c]), malformed])].map((it) => it.payload),
    [a.payload, b.payload, c.payload, malformed.payload],
  );
});

test("all folds every event, or none when one is not read", () => {
  const sum = (total: number, n: number) => total + n;
  assert.equal(all(0, [1, 2, 3], () => true, sum), 6);
  const state = { n: 0 };
  assert.equal(
    all(state, [1, -1], (n) => n > 0, (s, n) => ({ n: s.n + n })),
    state,
  );
});

// ── Through the graph's gate ────────────────────────────────────────────────

test("a batch folds to the same graph as its events one by one", () => {
  const events = [
    blockCreated("Foo", "hello [[Bar]]", undefined, "a"),
    blockEdited("a", "hi"),
    propertySet("Foo", "Owner", "Mira"),
  ];
  assert.deepEqual(fold(batch(events)), fold(...events));
});

test("a batch folds at its place: between two events, it lands between them", () => {
  const before = blockCreated("Foo", "one", undefined, "a");
  const after = blockEdited("a", "three");
  const middle = batch([blockEdited("a", "two")]);
  assert.equal(getPage(fold(before, middle, after), "Foo").blocks[0].text, "three");
  assert.equal(getPage(fold(before, after, middle), "Foo").blocks[0].text, "two");
});

test("one inner event this build cannot read skips the whole batch, and hands back the same state", () => {
  const start = fold(propertySet("Foo", "Owner", "Mira"));
  const set = propertySet("Foo", "Status", "done");
  const cases = [
    raw([set, { type: `${NAMESPACE}nothing.yet`, v: 1, payload: {} }]),
    raw([set, { ...propertyRemoved("Foo", "Owner"), v: 99 }]),
    raw([set, { type: `${NAMESPACE}property.removed`, v: 1, payload: { page: "Foo" } }]),
    raw([set, { type: "property.removed", v: 1, payload: { page: "Foo", key: "Owner" } }]),
  ];
  for (const event of cases) assert.equal(graphFold.reduce(start, event), start);
});

test("an empty batch, a non-list, a nested batch and a batch at a newer v are skipped", () => {
  const start = fold(propertySet("Foo", "Owner", "Mira"));
  const set = propertySet("Foo", "Status", "done");
  for (const event of [raw([]), raw({ 0: set }), raw([batch([set])]), raw([set], 2)]) {
    assert.equal(graphFold.reduce(start, event), start);
  }
});

test("an inner event that changes nothing still folds as it would alone", () => {
  const graph = fold(batch([blockEdited("missing", "x"), propertySet("Foo", "Owner", "Mira")]));
  assert.deepEqual(getProperties(graph, "Foo"), [{ key: "Owner", value: "Mira" }]);
});

test("each event in a batch is dated by the batch's at", () => {
  const at = "2026-11-03T10:00:00.000Z";
  const graph = fold({ ...batch([blockCreated("Foo", "x", undefined, "a"), propertySet("Bar", "k", "v")]), at });
  assert.equal(get(graph.edited, "foo"), Date.parse(at));
  assert.equal(get(graph.edited, "bar"), Date.parse(at));
});

test("predictions draw an in-flight batch as the fold will hold it", () => {
  const page = getPage(fold(blockCreated("Foo", "one", undefined, "a")), "Foo");
  const pending = batch([blockEdited("a", "two"), blockCreated("Foo", "three", undefined, "b")]);
  const landed = fold(blockCreated("Foo", "one", undefined, "a"), pending);
  assert.deepEqual(predict(page, [pending]), getPage(landed, "Foo"));

  const rename = batch([propertySet("Foo", "Author", "Mira"), propertyRemoved("Foo", "Owner")]);
  assert.deepEqual(
    predictProperties([{ key: "Owner", value: "Mira" }], "Foo", [rename]),
    [{ key: "Author", value: "Mira" }],
  );
});
