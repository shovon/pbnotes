/**
 * Run with: npm test
 *
 * `define` and `slice` over a counter that knows nothing of the graph: what
 * an event module is, apart from any event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CANNOT, same } from "../undo/undo.ts";
import { admits, over } from "./over.ts";
import type { Written } from "./over.ts";

/** A counter. */
type Count = { readonly n: number };

const COUNT = over<Count>();

/** A number, or undefined for anything else. */
const number = (payload: unknown) => (typeof payload === "number" ? payload : undefined);

const ADD = COUNT.define({
  type: "add",
  v: 2,
  parse: number,
  apply: (state, by) => (by === 0 ? state : { ...state, n: state.n + by }),
  landed: (state, by) => state.n >= by,
  undo: {
    inverse: (_, by) => [add(-by)],
    touched: () => [same((it) => it.n)],
  },
});

function add(by: number): Written<"add", number> {
  return ADD.build(by);
}

const RESET = COUNT.define({
  type: "reset",
  v: 1,
  parse: (payload) => (payload === null ? payload : undefined),
  apply: (state) => ({ ...state, n: 0 }),
  undo: "cannot",
});

const ZERO: Count = { n: 0 };

test("an event folds what it parses, and hands back the state for what it cannot", () => {
  assert.deepEqual(ADD.reduce(ZERO, 3), { n: 3 });
  assert.equal(ADD.reduce(ZERO, "three"), ZERO);
  assert.equal(ADD.reduce(ZERO, 0), ZERO, "a change that changes nothing");
  assert.equal(ADD.reads(3), true);
  assert.equal(ADD.reads("three"), false);
});

test("an event keeps whatever else the state holds", () => {
  const more = { ...ZERO, other: "kept" };
  assert.equal(ADD.reduce(more, 1).other, "kept");
});

test("an event builds itself with its own type and v", () => {
  assert.deepEqual(add(4), { v: 2, type: "add", payload: 4 });
  assert.deepEqual(RESET.build(null), { v: 1, type: "reset", payload: null });
});

test("landed is the event's own, and false when it has none or the payload is malformed", () => {
  assert.equal(ADD.landed({ n: 5 }, 3), true);
  assert.equal(ADD.landed({ n: 1 }, 3), false);
  assert.equal(ADD.landed({ n: 5 }, "three"), false);
  assert.equal(RESET.landed(ZERO, null), false);
});

test("undo reads the payload the event's own way, and cannot is the table's CANNOT", () => {
  assert.deepEqual(ADD.undo.inverse(ZERO, add(3)), [add(-3)]);
  assert.deepEqual(ADD.undo.inverse(ZERO, { type: "add", v: 2, payload: "x" }), []);
  assert.equal(ADD.undo.touched(ZERO, add(3)).length, 1);
  assert.equal(RESET.undo, CANNOT);
});

test("a slice routes each event to its module, and passes over the rest", () => {
  const slice = COUNT.slice([ADD, RESET]);
  assert.deepEqual(slice.handles, { add: 2, reset: 1 });
  assert.deepEqual(Object.keys(slice.undo).sort(), ["add", "reset"]);
  assert.deepEqual(slice.reduce(ZERO, { type: "add", payload: 2 }), { n: 2 });
  assert.deepEqual(slice.reduce({ n: 9 }, { type: "reset", payload: null }), ZERO);
  assert.equal(slice.reduce(ZERO, { type: "other", payload: 2 }), ZERO);
  assert.equal(slice.reads({ type: "add", payload: 2 }), true);
  assert.equal(slice.reads({ type: "add", payload: "x" }), false);
  assert.equal(slice.reads({ type: "other", payload: 2 }), false);
  assert.equal(slice.landed({ n: 5 }, { type: "add", payload: 3 }), true);
  assert.equal(slice.landed(ZERO, { type: "other", payload: 3 }), false);
});

test("a type that is an Object.prototype name is passed over like any other", () => {
  const slice = COUNT.slice([ADD]);
  assert.equal(slice.reduce(ZERO, { type: "__proto__", payload: 1 }), ZERO);
  assert.equal(slice.reads({ type: "toString", payload: 1 }), false);
});

test("two events with one type is refused", () => {
  assert.throws(() => COUNT.slice([ADD, ADD]), /Two events are add/);
});

test("the gate admits a type it has, at its own v or lower, and nothing else", () => {
  const handles = { add: 2 };
  assert.equal(admits(handles, { type: "add", v: 2 }), true);
  assert.equal(admits(handles, { type: "add", v: 1 }), true, "an older payload");
  assert.equal(admits(handles, { type: "add", v: 3 }), false, "a newer build wrote it");
  assert.equal(admits(handles, { type: "other", v: 1 }), false);
  assert.equal(admits(handles, { type: "toString", v: 1 }), false, "not an inherited name");
});

test("a slice's fold starts where it is told, and gates by v before it folds", () => {
  const fold = COUNT.slice([ADD, RESET]).fold({ n: 1 });
  assert.deepEqual(fold.initial, { n: 1 });
  const at = (v: number, payload: unknown) => ({ type: "add", v, payload });
  assert.deepEqual(fold.reduce(fold.initial, at(2, 4)), { n: 5 });
  assert.equal(fold.reduce(fold.initial, at(3, 4)), fold.initial, "a v this build cannot read");
  assert.equal(fold.reduce(fold.initial, at(2, "x")), fold.initial, "malformed");
  assert.equal(
    fold.reduce(fold.initial, { type: "other", v: 1, payload: 4 }),
    fold.initial,
    "another slice's event",
  );
});
