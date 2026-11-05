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
    { type: "outdentBlocks", blockIds: ["b1", "b2"] },
    { type: "indentBlock", blockId: "b1" },
    { type: "outdentBlock", blockId: "b1" },
    { type: "moveBlock", blockId: "b1", title: "Mira" },
    { type: "moveBlock", blockId: "b1", title: "Mira", after: "b2" },
    { type: "moveBlock", blockId: "b1", title: "Mira", after: "b2", parent: "b3" },
    { type: "moveBlock", blockId: "b1", title: "Mira", parent: "b3" },
    { type: "moveBlock", blockId: "b1", title: "2026-11-04", first: true },
    { type: "moveBlocks", blockIds: ["b1"], title: "Mira" },
    { type: "moveBlocks", blockIds: ["b1", "b2"], title: "Mira", after: "b3", parent: "b4" },
    { type: "moveBlocks", blockIds: ["b1", "b2"], title: "2026-11-04", first: true },
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
    { type: "outdentBlocks", blockIds: [] },
    { type: "outdentBlocks", blockIds: [1] },
    { type: "indentBlock", blockId: null },
    { type: "outdentBlock", blockId: ["b1"] },
    { type: "moveBlock", title: "Mira" },
    { type: "moveBlock", blockId: "b1" },
    { type: "moveBlock", blockId: "b1", title: " Mira" },
    { type: "moveBlock", blockId: "b1", title: "Mira", after: 2 },
    { type: "moveBlock", blockId: "b1", title: "Mira", parent: 7 },
    { type: "moveBlock", blockId: "b1", title: "Mira", first: false },
    { type: "moveBlocks", blockIds: [] as string[], title: "Mira" },
    { type: "moveBlocks", blockIds: "b1", title: "Mira" },
    { type: "moveBlocks", blockIds: ["b1"] },
    { type: "moveBlocks", blockIds: ["b1"], title: "Mira", parent: 3 },
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

const ID2 = "1f8fad5b-d9cb-469f-a165-70867728950e";
const paste = (fields: Record<string, unknown>) => ({
  type: "pasteBlocks",
  title: "Mira",
  blocks: [{ id: ID, text: "one", children: [{ id: ID2, text: "two", children: [] as unknown[] }] }],
  ...fields,
});

test("a paste passes with its blocks and one way of placing them (#261)", () => {
  for (const fields of [{}, { after: "b1" }, { after: "b1", parent: "b0" }, { parent: "b0" }, { first: true }, { into: "b1" }]) {
    const command = paste(fields);
    assert.deepEqual(requireCommand(command), command, JSON.stringify(fields));
  }
});

test("a paste's blocks are built fresh, from the fields they read", () => {
  const command = requireCommand({
    ...paste({}),
    blocks: [{ id: ID, text: "x", children: [], page: "Elsewhere", __proto__: { evil: 1 } }],
  });
  assert.deepEqual(command, { type: "pasteBlocks", title: "Mira", blocks: [{ id: ID, text: "x", children: [] }] });
});

test("a cut block's id passes, and one main would not let a window name is left off (#246)", () => {
  const kept = requireCommand(paste({ blocks: [{ id: ID, was: ID2, text: "x", children: [] }] }));
  assert.deepEqual(kept, { type: "pasteBlocks", title: "Mira", blocks: [{ id: ID, was: ID2, text: "x", children: [] }] });
  for (const was of ["b1", 3, null, "", ID2.toUpperCase()]) {
    const command = requireCommand(paste({ blocks: [{ id: ID, was, text: "x", children: [] }] }));
    assert.deepEqual(command, { type: "pasteBlocks", title: "Mira", blocks: [{ id: ID, text: "x", children: [] }] }, String(was));
  }
});

test("a paste that is malformed, too big or too deep is refused", () => {
  type Leaf = { id: string; text: string; children: Leaf[] };
  const leaf = (id: string): Leaf => ({ id, text: "", children: [] });
  for (const bad of [
    paste({ blocks: [] }),
    paste({ blocks: "x" }),
    paste({ blocks: [null] }),
    paste({ blocks: [{ id: "not-a-uuid", text: "x", children: [] }] }),
    paste({ blocks: [{ id: ID, text: 1, children: [] }] }),
    paste({ blocks: [{ id: ID, text: "x" }] }),
    paste({ title: " Mira" }),
    paste({ first: false }),
    paste({ after: 3 }),
    paste({ into: "b1", after: "b0" }),
    paste({ blocks: Array.from({ length: 10_001 }, () => leaf(ID)) }),
  ]) {
    assert.throws(() => requireCommand(bad), TypeError);
  }
  let deep = leaf(ID);
  for (let i = 0; i < 100; i++) deep = { ...leaf(ID), children: [deep] };
  assert.throws(() => requireCommand(paste({ blocks: [deep] })), /too deep/);
});
