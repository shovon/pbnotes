/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireCommand } from "./command.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("each command passes with the fields it reads", () => {
  const good = [
    { type: "addBlock", id: ID, title: "Mira", text: "hi" },
    { type: "addBlock", id: ID, title: "Mira", text: "", after: "b1" },
    { type: "editBlock", blockId: "b1", text: "hi" },
    { type: "deleteBlock", blockId: "b1" },
    { type: "indentBlock", blockId: "b1" },
    { type: "outdentBlock", blockId: "b1" },
  ];
  for (const command of good) assert.deepEqual(requireCommand(command), command);
});

test("a missing or wrong-typed field is refused", () => {
  const bad = [
    { type: "addBlock", title: "Mira", text: "hi" },
    { type: "addBlock", id: "not-a-uuid", title: "Mira", text: "hi" },
    { type: "addBlock", id: ID, title: " Mira", text: "hi" },
    { type: "addBlock", id: ID, title: "", text: "hi" },
    { type: "addBlock", id: ID, title: "Mira", text: 1 },
    { type: "addBlock", id: ID, title: "Mira", text: "hi", after: 3 },
    { type: "editBlock", blockId: "b1" },
    { type: "editBlock", text: "hi" },
    { type: "deleteBlock" },
    { type: "indentBlock", blockId: null },
    { type: "outdentBlock", blockId: ["b1"] },
  ];
  for (const command of bad) {
    assert.throws(() => requireCommand(command), TypeError, JSON.stringify(command));
  }
});

test("an unknown type is refused, inherited names among them", () => {
  for (const type of ["setTitle", "__proto__", "constructor", "toString", "hasOwnProperty", 1, undefined]) {
    assert.throws(() => requireCommand({ type, blockId: "b1" }), /Unknown command/, String(type));
  }
  const notObjects: unknown[] = [null, undefined, "editBlock", 3, []];
  for (const value of notObjects) {
    assert.throws(() => requireCommand(value), TypeError);
  }
});

test("a field the object inherits is not read", () => {
  const inherited = Object.create({ blockId: "b1" });
  inherited.type = "deleteBlock";
  assert.throws(() => requireCommand(inherited), TypeError);
});

test("fields a command does not read are dropped", () => {
  assert.deepEqual(
    requireCommand({ type: "editBlock", blockId: "b1", text: "hi", junk: { big: true }, title: "Mira" }),
    { type: "editBlock", blockId: "b1", text: "hi" },
  );
  assert.deepEqual(
    requireCommand({ type: "addBlock", id: ID, title: "Mira", text: "hi", after: undefined, page: "x" }),
    { type: "addBlock", id: ID, title: "Mira", text: "hi" },
  );
});
