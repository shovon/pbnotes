/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDispatcher } from "./dispatcher.ts";
import type { Field, Way } from "./dispatcher.ts";

/** A field with `undos` steps to undo and `redos` to redo, recording what was asked of it. */
function field(undos: number, redos: number, reachesDocument = true) {
  const asked: string[] = [];
  const it: Field = {
    canUndo: () => undos > 0,
    canRedo: () => redos > 0,
    undo: () => {
      asked.push("undo");
      undos--;
      redos++;
    },
    redo: () => {
      asked.push("redo");
      redos--;
      undos++;
    },
    close: () => asked.push("close"),
    reachesDocument,
  };
  return { it, asked };
}

/** A dispatcher, and every way it sent to main. */
function dispatcher() {
  const taken: Way[] = [];
  return { taken, dispatch: createDispatcher((way) => taken.push(way)) };
}

test("with no field open, undo and redo go to main", () => {
  const { taken, dispatch } = dispatcher();
  dispatch.undo();
  dispatch.redo();
  assert.deepEqual(taken, ["undo", "redo"]);
});

test("with steps in the field, undo stays in the field", () => {
  const { taken, dispatch } = dispatcher();
  const { it, asked } = field(2, 0);
  dispatch.focus(it);
  dispatch.undo();
  dispatch.undo();
  assert.deepEqual(asked, ["undo", "undo"]);
  assert.deepEqual(taken, []);
});

test("with none left, a note field closes and undo goes to main", () => {
  const { taken, dispatch } = dispatcher();
  const { it, asked } = field(0, 0);
  dispatch.focus(it);
  dispatch.undo();
  assert.deepEqual(asked, ["close"]);
  assert.deepEqual(taken, ["undo"]);
});

test("the search box never reaches main: with none left, undo and redo do nothing", () => {
  const { taken, dispatch } = dispatcher();
  const { it, asked } = field(0, 0, false);
  dispatch.focus(it);
  dispatch.undo();
  dispatch.redo();
  assert.deepEqual([asked, taken], [[], []]);
});

test("redo stays in the field while it has an undo to redo", () => {
  const { taken, dispatch } = dispatcher();
  const { it, asked } = field(1, 0);
  dispatch.focus(it);
  dispatch.undo();
  dispatch.redo();
  assert.deepEqual(asked, ["undo", "redo"]);
  assert.deepEqual(taken, []);
});

test("redo in a field typed in since does nothing, rather than reach main", () => {
  const { taken, dispatch } = dispatcher();
  const { it, asked } = field(1, 0);
  dispatch.focus(it);
  dispatch.redo();
  assert.deepEqual([asked, taken], [[], []]);
});

test("redo in an untouched field closes it and goes to main", () => {
  const { taken, dispatch } = dispatcher();
  const { it, asked } = field(0, 0);
  dispatch.focus(it);
  dispatch.redo();
  assert.deepEqual([asked, taken], [["close"], ["redo"]]);
});

test("a field that lost focus is no longer asked, and a stale release lets go of nothing", () => {
  const { taken, dispatch } = dispatcher();
  const one = field(1, 0);
  const two = field(1, 0);
  const releaseOne = dispatch.focus(one.it);
  dispatch.focus(two.it);
  releaseOne();
  dispatch.undo();
  assert.deepEqual([one.asked, two.asked], [[], ["undo"]], "the second still has focus");
  dispatch.focus(two.it)();
  dispatch.undo();
  assert.deepEqual(taken, ["undo"]);
});
