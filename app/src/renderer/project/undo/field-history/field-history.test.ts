/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canRedo, canUndo, EMPTY, PAUSE, redo, typed, undo } from "./field-history.ts";
import type { FieldHistory, Snapshot } from "./field-history.ts";

/** `value` with the caret at its end. */
const at = (value: string, caret = value.length): Snapshot => ({ value, start: caret, end: caret });

/**
 * Types `text` into `from`, one character every 100 ms from `t`, as a person
 * would: each a change of its own. Hands back the history, the field, and
 * the time after.
 */
function type(history: FieldHistory, from: Snapshot, text: string, t = 0) {
  let field = from;
  for (const ch of text) {
    const value = field.value.slice(0, field.start) + ch + field.value.slice(field.end);
    const next = at(value, field.start + 1);
    history = typed(history, field, next, { kind: "insert", data: ch, at: t });
    field = next;
    t += 100;
  }
  return { history, field, t };
}

/** Undoes everything there is, collecting each value the field goes back to. */
function undoAll(history: FieldHistory, field: Snapshot): string[] {
  const seen: string[] = [];
  for (let it = undo(history, field); it; it = undo(it.history, it.to)) seen.push(it.to.value);
  return seen;
}

test("a run of typing is one step per word", () => {
  const { history, field } = type(EMPTY, at(""), "hello world");
  assert.deepEqual(undoAll(history, field), ["hello ", ""]);
});

test("a pause starts a step", () => {
  const first = type(EMPTY, at(""), "ab");
  const { history, field } = type(first.history, first.field, "cd", first.t + PAUSE + 1);
  assert.deepEqual(undoAll(history, field), ["ab", ""]);
});

test("a switch between typing and deleting starts a step", () => {
  const { history, field, t } = type(EMPTY, at(""), "abc");
  const deleted = at("ab");
  const next = typed(history, field, deleted, { kind: "delete", data: null, at: t });
  assert.deepEqual(undoAll(next, deleted), ["abc", ""]);
});

test("a jump of the caret starts a step", () => {
  const first = type(EMPTY, at(""), "abcd");
  // The caret moved to the start before the next character.
  const { history, field } = type(first.history, at("abcd", 0), "x", first.t);
  assert.deepEqual(undoAll(history, field), ["abcd", ""]);
});

test("an edit of the field's own is a step apart from the typing either side", () => {
  const first = type(EMPTY, at(""), "see ");
  const bracket = at("see [[]]", 6);
  let history = typed(first.history, first.field, bracket, {
    kind: "insert",
    data: "[[]]",
    at: first.t,
    own: true,
  });
  ({ history } = type(history, bracket, "Foo", first.t + 100));
  const field = at("see [[Foo]]", 9);
  assert.deepEqual(undoAll(history, field), ["see [[]]", "see ", ""]);
});

test("undo and redo put back the text and the selection, and new typing clears redo", () => {
  const { history, field, t } = type(EMPTY, at(""), "ab");
  const undone = undo(history, field);
  assert.ok(undone);
  assert.deepEqual(undone.to, at(""));
  assert.equal(canRedo(undone.history), true);
  const redone = redo(undone.history, undone.to);
  assert.ok(redone);
  assert.deepEqual(redone.to, at("ab"));
  const again = undo(redone.history, redone.to);
  assert.ok(again);
  const after = type(again.history, again.to, "z", t + 1000);
  assert.equal(canRedo(after.history), false);
});

test("a change that left the text as it was is none", () => {
  assert.equal(typed(EMPTY, at("a"), at("a"), { kind: "insert", data: "", at: 0 }), EMPTY);
});

test("a field just opened has nothing to undo or redo", () => {
  assert.equal(canUndo(EMPTY), false);
  assert.equal(canRedo(EMPTY), false);
  assert.equal(undo(EMPTY, at("x")), undefined);
  assert.equal(redo(EMPTY, at("x")), undefined);
});
