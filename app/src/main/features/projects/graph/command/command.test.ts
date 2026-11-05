/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireCommand, requireDay } from "./command.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("each command passes with the fields it reads", () => {
  const good = [
    { type: "addBlock", id: ID, title: "Mira", text: "hi" },
    { type: "addBlock", id: ID, title: "Mira", text: "", after: "b1" },
    { type: "editBlock", blockId: "b1", text: "hi" },
    { type: "deleteBlock", blockId: "b1" },
    { type: "deleteBlocks", blockIds: ["b1"] },
    { type: "deleteBlocks", blockIds: ["b1", "b2"] },
    { type: "indentBlocks", blockIds: ["b1", "b2"] },
    { type: "indentBlock", blockId: "b1" },
    { type: "outdentBlock", blockId: "b1" },
    { type: "setProperty", title: "Mira", key: "Status", value: "done" },
    { type: "setProperty", title: "Mira", key: "Status", value: "" },
    { type: "removeProperty", title: "Mira", key: "Status" },
    { type: "renameProperty", title: "Mira", from: "Owner", to: "Author" },
    { type: "addTag", title: "Mira", tag: "Work" },
    { type: "removeTag", title: "Mira", tag: "Work" },
    { type: "deletePage", title: "Mira" },
    { type: "undo" },
    { type: "redo" },
  ];
  for (const command of good) assert.deepEqual(requireCommand(command), command);
});

test("undo and redo carry nothing the window sent: what to take back is main's (#234)", () => {
  assert.deepEqual(requireCommand({ type: "undo", step: 3, blockId: "b1" }), { type: "undo" });
  assert.deepEqual(requireCommand({ type: "redo", events: [] }), { type: "redo" });
  for (const bad of [{ type: "Undo" }, { type: "undo " }, { type: ["undo"] }, "undo", null]) {
    assert.throws(() => requireCommand(bad), TypeError, JSON.stringify(bad));
  }
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
    { type: "deleteBlocks" },
    { type: "deleteBlocks", blockIds: [] },
    { type: "deleteBlocks", blockIds: "b1" },
    { type: "deleteBlocks", blockIds: ["b1", 2] },
    { type: "indentBlocks", blockIds: [] },
    { type: "indentBlocks" },
    { type: "indentBlock", blockId: null },
    { type: "outdentBlock", blockId: ["b1"] },
    { type: "setProperty", title: "Mira", key: "Status" },
    { type: "setProperty", title: "Mira", key: " Status", value: "done" },
    { type: "setProperty", title: "Mira", key: "", value: "done" },
    { type: "setProperty", key: "Status", value: "done" },
    { type: "setProperty", title: "Mira", key: "Status", value: 3 },
    { type: "removeProperty", title: "Mira" },
    { type: "removeProperty", title: "Mira", key: 1 },
    { type: "renameProperty", title: "Mira", from: "Owner" },
    { type: "renameProperty", title: "Mira", from: "Owner", to: "Author " },
    { type: "addTag", title: "Mira" },
    { type: "addTag", tag: "Work" },
    { type: "addTag", title: "Mira", tag: "" },
    { type: "addTag", title: "Mira", tag: " Work" },
    { type: "addTag", title: 1, tag: "Work" },
    { type: "removeTag", title: "Mira" },
    { type: "removeTag", title: "Mira", tag: ["Work"] },
    { type: "removeTag", title: "", tag: "Work" },
    { type: "deletePage" },
    { type: "deletePage", title: 3 },
    { type: "deletePage", title: "" },
    { type: "deletePage", title: " Mira" },
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
  assert.deepEqual(
    requireCommand({ type: "addTag", title: "Mira", tag: "Work", key: "x", value: "y" }),
    { type: "addTag", title: "Mira", tag: "Work" },
  );
});

test("today is a day as YYYY-MM-DD, and nothing else", () => {
  assert.equal(requireDay("2026-10-31"), "2026-10-31");
  for (const bad of [undefined, 20261031, "", "2026-10-31T00:00", "Oct 31"]) {
    assert.throws(() => requireDay(bad), TypeError);
  }
});
