/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checked, labelled, readTask, withMarker } from "./tasks.ts";

test("each marker is read with the text after it", () => {
  assert.deepEqual(readTask("TODO buy milk"), { marker: "TODO", rest: "buy milk" });
  assert.deepEqual(readTask("DOING buy milk"), { marker: "DOING", rest: "buy milk" });
  assert.deepEqual(readTask("DONE buy milk"), { marker: "DONE", rest: "buy milk" });
});

test("a marker alone is a task with nothing after it", () => {
  assert.deepEqual(readTask("TODO"), { marker: "TODO", rest: "" });
  assert.deepEqual(readTask("TODO   "), { marker: "TODO", rest: "" });
});

test("a line break after the marker is kept in the rest", () => {
  assert.deepEqual(readTask("TODO\nsecond line"), { marker: "TODO", rest: "\nsecond line" });
});

test("only the capitalised word at the very start is a marker", () => {
  assert.equal(readTask("TODOs to sort"), undefined);
  assert.equal(readTask("todo later"), undefined);
  assert.equal(readTask("Todo later"), undefined);
  assert.equal(readTask(" TODO indented"), undefined);
  assert.equal(readTask("buy milk TODO"), undefined);
  assert.equal(readTask("DONEish"), undefined);
  assert.equal(readTask(""), undefined);
});

test("withMarker swaps the marker and leaves the rest byte for byte", () => {
  assert.equal(withMarker("TODO buy [[milk]]", "DONE"), "DONE buy [[milk]]");
  assert.equal(withMarker("DONE  two spaces", "TODO"), "TODO  two spaces");
  assert.equal(withMarker("DOING\nnext line", "TODO"), "TODO\nnext line");
  assert.equal(withMarker("TODO", "DOING"), "DOING");
});

test("withMarker puts a marker in front of text that has none", () => {
  assert.equal(withMarker("buy milk", "TODO"), "TODO buy milk");
});

test("checking is done, unchecking is to do", () => {
  assert.equal(checked(true), "DONE");
  assert.equal(checked(false), "TODO");
});

test("the label swaps to do and doing", () => {
  assert.equal(labelled("TODO"), "DOING");
  assert.equal(labelled("DOING"), "TODO");
});
