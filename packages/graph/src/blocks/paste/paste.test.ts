/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, getPage, graphFold, indentBlock, invert, pasteBlocks } from "../../graph.ts";
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
