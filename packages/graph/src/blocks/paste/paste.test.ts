/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, deleteBlocks, getPage, graphFold, indentBlock, invert, pasteBlocks } from "../../graph.ts";
import type { Pasting } from "../../graph.ts";
import type { Graph, GraphView } from "../../graph.ts";
import type { Block } from "../blocks.ts";

const PAGE = "Notes";

/** A view over a plain list of events, folded through the gate. */
function memory(): GraphView & { events: { type: string; v: number; payload: unknown }[] } {
  const events: { type: string; v: number; payload: unknown }[] = [];
  let state: Graph = graphFold.initial;
  return {
    events,
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      const event = { type, v, payload };
      events.push(event);
      state = graphFold.reduce(state, event);
    },
  };
}

const block = (id: string, text: string, ...children: Block[]): Block => ({ id, text, children });

/** The page as ids and text, nested, for comparing at a glance. */
const shape = (blocks: Block[]): unknown[] =>
  blocks.map((it) => (it.children.length ? [it.text, shape(it.children)] : it.text));

/** `a`, then `b` with `c` under it. */
async function seeded() {
  const view = memory();
  await addBlock(view, PAGE, "a", undefined, "a");
  await addBlock(view, PAGE, "b", "a", "b");
  await addBlock(view, PAGE, "c", "b", "c");
  await indentBlock(view, "c");
  return view;
}

const copied = [block("p", "one", block("q", "one.1")), block("r", "two")];

test("a paste after a block goes beneath it, the blocks nested as copied, as one record", async () => {
  const view = await seeded();
  const before = view.events.length;
  await pasteBlocks(view, PAGE, copied, { after: "a" });
  assert.deepEqual(shape(getPage(view.state, PAGE).blocks), [
    "a",
    ["one", ["one.1"]],
    "two",
    ["b", ["c"]],
  ]);
  assert.equal(view.events.length, before + 1);
  assert.match(view.events.at(-1)!.type, /#batch$/);
});

test("a paste at the end of the page, or under a parent, lands there", async () => {
  const end = await seeded();
  await pasteBlocks(end, PAGE, copied, {});
  assert.deepEqual(shape(getPage(end.state, PAGE).blocks).slice(-2), [["one", ["one.1"]], "two"]);

  const under = await seeded();
  await pasteBlocks(under, PAGE, copied, { after: "c", parent: "b" });
  assert.deepEqual(shape(getPage(under.state, PAGE).blocks), [
    "a",
    ["b", ["c", ["one", ["one.1"]], "two"]],
  ]);
});

test("a paste into an empty block replaces it: its id stays, the rest follow it", async () => {
  const view = memory();
  await addBlock(view, PAGE, "", undefined, "e");
  await addBlock(view, PAGE, "after", "e", "z");
  await pasteBlocks(view, PAGE, copied, { into: "e" });
  const blocks = getPage(view.state, PAGE).blocks;
  assert.deepEqual(shape(blocks), [["one", ["one.1"]], "two", "after"]);
  assert.equal(blocks[0].id, "e");
});

test("into a block with children of its own, the first block's children go after them", async () => {
  const view = await seeded();
  await pasteBlocks(view, PAGE, [block("p", "b", block("q", "new"))], { into: "b" });
  assert.deepEqual(shape(getPage(view.state, PAGE).blocks), ["a", ["b", ["c", "new"]]]);
});

test("into a nested block, the rest stay at its depth", async () => {
  const view = await seeded();
  await pasteBlocks(view, PAGE, copied, { into: "c" });
  assert.deepEqual(shape(getPage(view.state, PAGE).blocks), [
    "a",
    ["b", [["one", ["one.1"]], "two"]],
  ]);
});

test("one undo takes the whole paste back", async () => {
  const view = await seeded();
  const before = view.state;
  await pasteBlocks(view, PAGE, copied, { after: "a" });
  const undo = invert(before, [view.events.at(-1)!]);
  assert.ok(undo);
  const undone = undo.reduce((state, event) => graphFold.reduce(state, event), view.state);
  assert.deepEqual(shape(getPage(undone, PAGE).blocks), ["a", ["b", ["c"]]]);
});

test("an id the graph has, or one named twice, is refused, and nothing is written", async () => {
  const view = await seeded();
  const before = view.events.length;
  await assert.rejects(pasteBlocks(view, PAGE, [block("a", "x")], {}), /already exists/);
  await assert.rejects(
    pasteBlocks(view, PAGE, [block("p", "x", block("p", "y"))], {}),
    /named twice/,
  );
  assert.equal(view.events.length, before);
});

test("a place the page lacks is refused, as addBlock refuses it", async () => {
  const view = await seeded();
  await assert.rejects(pasteBlocks(view, PAGE, copied, { after: "gone" }), /No such block/);
  await assert.rejects(pasteBlocks(view, PAGE, copied, { into: "gone" }), /No such block/);
  await assert.rejects(pasteBlocks(view, PAGE, copied, { after: "a", parent: "b" }), /not a child/);
  await assert.rejects(pasteBlocks(view, PAGE, [], {}), /Nothing to paste/);
});

// ── A cut, pasted (#246) ────────────────────────────────────────────────────

/** A block of a cut: a fresh id for a copy, and the id it was cut with. */
const cut = (fresh: string, was: string, text: string, ...children: Pasting[]): Pasting => ({
  id: fresh,
  was,
  text,
  children,
});

/** Each block's id, nested, so kept ids show. */
const named = (blocks: Block[]): unknown[] =>
  blocks.map((it) => (it.children.length ? [it.id, named(it.children)] : it.id));

/** `seeded`, with `b` (and `c` under it) cut: deleted, and its cut to paste. */
async function cutB() {
  const view = await seeded();
  await deleteBlocks(view, ["b"]);
  return { view, pasting: [cut("n1", "b", "b", cut("n2", "c", "c"))] };
}

test("the first paste of a cut keeps its ids, so the blocks are back, elsewhere", async () => {
  const { view, pasting } = await cutB();
  const before = view.events.length;
  await pasteBlocks(view, "Elsewhere", pasting, {});
  assert.deepEqual(named(getPage(view.state, "Elsewhere").blocks), [["b", ["c"]]]);
  assert.deepEqual(named(getPage(view.state, PAGE).blocks), ["a"]);
  assert.equal(view.events.length, before + 1, "one record");
});

test("a later paste of the same cut finds its ids held, and is a copy", async () => {
  const { view, pasting } = await cutB();
  await pasteBlocks(view, "Elsewhere", pasting, {});
  await pasteBlocks(view, "Elsewhere", [cut("m1", "b", "b", cut("m2", "c", "c"))], {});
  assert.deepEqual(named(getPage(view.state, "Elsewhere").blocks), [["b", ["c"]], ["m1", ["m2"]]]);
});

test("each block keeps its cut id on its own: one held gets the fresh id, the rest keep theirs", async () => {
  const view = await seeded();
  await deleteBlocks(view, ["b"]);
  // `a` is still on the page; `b` and `c` are not.
  await pasteBlocks(view, "Elsewhere", [cut("n1", "a", "a", cut("n2", "c", "c")), cut("n3", "b", "b")], {});
  assert.deepEqual(named(getPage(view.state, "Elsewhere").blocks), [["n1", ["c"]], "b"]);
});

test("a cut id named twice in one paste is kept once", async () => {
  const { view } = await cutB();
  await pasteBlocks(view, "Elsewhere", [cut("n1", "b", "x"), cut("n2", "b", "y")], {});
  assert.deepEqual(named(getPage(view.state, "Elsewhere").blocks), ["b", "n2"]);
});

test("a cut pasted into an empty block goes after it, takes its children, and deletes it", async () => {
  const { view, pasting } = await cutB();
  await addBlock(view, "Elsewhere", "", undefined, "e");
  await addBlock(view, "Elsewhere", "kid", undefined, "k", "e");
  await addBlock(view, "Elsewhere", "after", "e", "z");
  const before = view.state;
  const written = view.events.length;
  await pasteBlocks(view, "Elsewhere", pasting, { into: "e" });
  assert.deepEqual(named(getPage(view.state, "Elsewhere").blocks), [["b", ["c", "k"]], "z"]);
  assert.equal(view.events.length, written + 1, "one record");
  const undo = invert(before, [view.events.at(-1)!]);
  assert.ok(undo);
  const undone = undo.reduce((state, event) => graphFold.reduce(state, event), view.state);
  assert.deepEqual(named(getPage(undone, "Elsewhere").blocks), [["e", ["k"]], "z"], "one undo puts the empty block back");
});

test("a copy pasted into an empty block still takes its id", async () => {
  const view = memory();
  await addBlock(view, PAGE, "", undefined, "e");
  await pasteBlocks(view, PAGE, [{ id: "p", text: "one", children: [] }], { into: "e" });
  assert.deepEqual(named(getPage(view.state, PAGE).blocks), ["e"]);
});
