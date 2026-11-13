/**
 * Run with: npm test
 *
 * `block.moved` on its own (#252): how it is read, where it puts a block, what
 * it ignores, how it is written, and how it is undone. Each test is its own
 * composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../../event/event.ts";
import { getPage, graphFold, holds, invert, predict, remember } from "../../graph.ts";
import type { Batched, Block, Graph } from "../../graph.ts";
import { blockCreated } from "../created/created.ts";
import { blockEdited } from "../edited/edited.ts";
import { blockIndented } from "../indented/indented.ts";
import { blockOutdented } from "../outdented/outdented.ts";
import { BLOCK_MOVED, blockMoved } from "./moved.ts";
import * as forest from "../../forest/forest.ts";
import { blocksOn } from "../blocks.ts";

/** `events` folded onto `state`, through the gate. */
const fold = (state: Graph, ...events: Batched[]): Graph => events.reduce(graphFold.reduce, state);

/** A page as `id(children…)`, so a case reads as the outline it makes. */
const shape = (blocks: Block[]): string =>
  blocks.map((it) => (it.children.length ? `${it.id}(${shape(it.children)})` : it.id)).join(" ");

/** Each page that has blocks, as its title and outline. */
const outline = (graph: Graph) =>
  Object.fromEntries(
    [...forest.groups(graph.forest)]
      .map((key) => [key, shape(blocksOn(graph, key))])
      .filter(([, outline]) => outline),
  );

/**
 *   Foo: a(a1 a2) b(b1) c
 *   Bar: x
 */
const START = fold(
  graphFold.initial,
  blockCreated("Foo", "A", undefined, "a"),
  blockCreated("Foo", "A1", undefined, "a1", "a"),
  blockCreated("Foo", "A2", "a1", "a2", "a"),
  blockCreated("Foo", "B", "a", "b"),
  blockCreated("Foo", "B1", undefined, "b1", "b"),
  blockCreated("Foo", "C", "b", "c"),
  blockCreated("Bar", "X", undefined, "x"),
);

test("a move is read with its page and place, and refused without an id or a page", () => {
  const read = (payload: unknown) => BLOCK_MOVED.parse(payload);
  assert.deepEqual(read({ id: "a", page: "Foo", after: "c", parent: "b", first: true, extra: 1 }), {
    id: "a",
    page: "Foo",
    after: "c",
    parent: "b",
    first: true,
  });
  assert.deepEqual(read({ id: "a", page: "Foo", after: "", parent: 5, first: "yes" }), { id: "a", page: "Foo" });
  assert.equal(read({ id: "a" }), undefined, "no page");
  assert.equal(read({ id: "a", page: 5 }), undefined, "a page that is not a string");
  assert.equal(read({ page: "Foo" }), undefined, "no id");
  assert.equal(read(null), undefined);
});

test("a block moves with its children: lower, under another block, onto another page, and to the top", () => {
  const cases: [string, Batched, Record<string, string>][] = [
    ["lower on its page", blockMoved({ id: "a", page: "Foo", after: "c" }), { foo: "b(b1) c a(a1 a2)", bar: "x" }],
    ["under another block", blockMoved({ id: "a", page: "Foo", parent: "b" }), { foo: "b(a(a1 a2) b1) c", bar: "x" }],
    ["after a child", blockMoved({ id: "c", page: "Foo", after: "a1", parent: "a" }), { foo: "a(a1 c a2) b(b1)", bar: "x" }],
    ["onto another page", blockMoved({ id: "a", page: "Bar", after: "x" }), { foo: "b(b1) c", bar: "x a(a1 a2)" }],
    ["first on another page", blockMoved({ id: "b", page: "Bar", first: true }), { foo: "a(a1 a2) c", bar: "b(b1) x" }],
    ["the end of a page", blockMoved({ id: "a1", page: "Bar" }), { foo: "a(a2) b(b1) c", bar: "x a1" }],
    ["out of its parent", blockMoved({ id: "b1", page: "Foo", first: true }), { foo: "b1 a(a1 a2) b c", bar: "x" }],
  ];
  for (const [name, move, expected] of cases) {
    assert.deepEqual(outline(fold(START, move)), expected, name);
  }
});

test("a move onto a page with no blocks makes the page, spelled as the move wrote it", () => {
  const after = fold(START, blockMoved({ id: "b", page: "New Page" }));
  const page = getPage(after, "new page");
  assert.deepEqual([page.title, shape(page.blocks)], ["New Page", "b(b1)"]);
});

test("a move that cannot be followed leaves the graph as it was, the very same object", () => {
  const cases: [string, Batched][] = [
    ["under itself", blockMoved({ id: "a", page: "Foo", parent: "a" })],
    ["under its own child", blockMoved({ id: "a", page: "Foo", parent: "a1" })],
    ["after its own child", blockMoved({ id: "a", page: "Foo", after: "a2", parent: "a" })],
    ["a block the graph lacks", blockMoved({ id: "gone", page: "Foo" })],
    ["after a block the page lacks", blockMoved({ id: "c", page: "Foo", after: "gone" })],
    ["after a block on another page", blockMoved({ id: "c", page: "Foo", after: "x" })],
    ["under a parent the page lacks", blockMoved({ id: "c", page: "Foo", parent: "gone" })],
    ["after one not the parent's child", blockMoved({ id: "c", page: "Foo", after: "b1", parent: "a" })],
    ["where it already is", blockMoved({ id: "c", page: "foo", after: "b" })],
  ];
  for (const [name, move] of cases) assert.equal(fold(START, move), START, name);
});

test("two writers each moving one block under the other: the second move changes nothing (#62)", () => {
  const one = fold(START, blockMoved({ id: "a", page: "Foo", parent: "b" }));
  assert.equal(fold(one, blockMoved({ id: "b", page: "Foo", parent: "a" })), one);
});

test("blockMoved writes the event's own type and v, and leaves off what is absent", () => {
  assert.deepEqual(blockMoved({ id: "a", page: "Foo", after: undefined, parent: "b" }), {
    v: BLOCK_MOVED.v,
    type: BLOCK_MOVED.type,
    payload: { id: "a", page: "Foo", parent: "b" },
  });
  assert.equal(BLOCK_MOVED.type, `${NAMESPACE}block.moved`);
});

test("a move is undone back to its page, parent and siblings, and redone by moving it again", () => {
  const moves = [
    blockMoved({ id: "a2", page: "Bar", after: "x" }),
    blockMoved({ id: "a1", page: "Foo", after: "b1", parent: "b" }),
    blockMoved({ id: "a", page: "Foo" }),
    blockMoved({ id: "b", page: "Elsewhere" }),
  ];
  for (const move of moves) {
    const after = fold(START, move);
    const inverse = invert(START, [move]);
    assert.ok(inverse && inverse.length === 1, JSON.stringify(move.payload));
    const undone = fold(after, ...inverse);
    assert.deepEqual(outline(undone), outline(START), JSON.stringify(move.payload));
    assert.deepEqual(outline(fold(undone, move)), outline(after), "redone");
  }
  assert.deepEqual(invert(START, [blockMoved({ id: "gone", page: "Foo" })]), [], "a move that changed nothing");
});

test("a move holds through edits and writing under it, and not once the block moves again", () => {
  const move = blockMoved({ id: "a", page: "Bar", after: "x" });
  const after = fold(START, move);
  const step = remember(START, [move]);
  assert.equal(holds(fold(after, blockEdited("a", "A!")), step), true, "its text");
  assert.equal(holds(fold(after, blockCreated("Bar", "A3", "a2", "a3", "a")), step), true, "under it");
  assert.equal(holds(fold(after, blockMoved({ id: "a", page: "Foo" })), step), false);
});

test("a prediction that already shows the move does not fold it again", () => {
  const move = blockMoved({ id: "c", page: "Foo", first: true });
  const page = getPage(fold(START, move), "Foo");
  assert.equal(shape(predict(page, [move]).blocks), shape(page.blocks));
  assert.equal(shape(predict(getPage(START, "Foo"), [move]).blocks), "c a(a1 a2) b(b1)");
});

test("an indent or an outdent from another writer's log is undone, by a move back", () => {
  // No command writes these: `c`'s sibling above is `b`, not `a`, and `b1`
  // hangs under `b`, not `a`.
  const elsewhere = [blockIndented({ id: "c", parent: "a" }), blockOutdented({ id: "b1", after: "a" })];
  for (const event of elsewhere) {
    const inverse = invert(START, [event]);
    assert.ok(inverse, JSON.stringify(event.payload));
    assert.deepEqual(outline(fold(START, event, ...inverse)), outline(START), JSON.stringify(event.payload));
  }
});

test("a build without the type keeps the block where it was, and its later edits land", () => {
  const older = (state: Graph, event: Batched) => (event.type === BLOCK_MOVED.type ? state : graphFold.reduce(state, event));
  const log = [blockMoved({ id: "a", page: "Bar" }), blockEdited("a", "A!")];
  const graph = log.reduce(older, START);
  assert.equal(shape(getPage(graph, "Foo").blocks), "a(a1 a2) b(b1) c");
  assert.equal(getPage(graph, "Foo").blocks[0].text, "A!");
});
