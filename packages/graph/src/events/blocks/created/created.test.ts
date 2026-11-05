/**
 * Run with: npm test
 *
 * `block.created` on its own: where it puts a block, how it is written, and how it is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../../events.ts";
import { getPage, graphFold, holds, invert, remember } from "../../../graph.ts";
import type { Batched, Graph } from "../../../graph.ts";
import type { Block } from "../../../blocks/blocks.ts";
import { predict, reduce } from "../slice.ts";
import type { PageEvent } from "../slice.ts";
import { blockDeleted } from "../deleted/deleted.ts";
import { blockEdited } from "../edited/edited.ts";
import { BLOCK_CREATED, blockCreated } from "./created.ts";

const TODAY = "2026-09-21";

/** Nothing written yet: the fold's own start, so it has every field `Graph` does. */
const empty = (): Graph => graphFold.initial;

/** One event, straight into `reduce`, with no log or device around it. */
function event(type: string, v: number, payload: unknown) {
  return { type, v, payload };
}

/** `events` folded onto `state`, through the gate. */
const fold = (state: Graph, ...events: Batched[]): Graph => events.reduce(graphFold.reduce, state);

/**
 * #226: `parent` writes a child in one event. Each case starts from `a` with
 * one child `c`, and `z` at the top level, and lands `n` somewhere.
 */
test("a parent places a created block under it, and falls back rather than dropping it", () => {
  const created = (payload: object) =>
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "n", text: "new", ...payload });
  const start = [
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "a", text: "A" }),
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "c", text: "C", parent: "a" }),
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "z", text: "Z" }),
  ].reduce(reduce, empty());
  /** The page as `id(children…)`, so a case reads as the outline it makes. */
  const shape = (blocks: Block[]): string =>
    blocks
      .map((it) => (it.children.length ? `${it.id}(${shape(it.children)})` : it.id))
      .join(" ");
  const cases: [string, object, string][] = [
    ["parent alone: first child", { parent: "a" }, "a(n c) z"],
    ["a nested parent", { parent: "c" }, "a(c(n)) z"],
    ["after a child of the parent", { parent: "a", after: "c" }, "a(c n) z"],
    ["after outside the parent: the parent wins", { parent: "a", after: "z" }, "a(n c) z"],
    ["after missing: the parent wins", { parent: "a", after: "gone" }, "a(n c) z"],
    ["parent missing, no after: end of page", { parent: "gone" }, "a(c) z n"],
    ["parent missing, after present: after places it", { parent: "gone", after: "a" }, "a(c) z n"],
    ["parent not a string: ignored", { parent: 5, after: "a" }, "a(c) n z"],
  ];
  for (const [name, payload, expected] of cases) {
    assert.equal(shape(getPage(reduce(start, created(payload)), TODAY).blocks), expected, name);
  }
  assert.equal(shape(getPage(start, TODAY).blocks), "a(c) z", "the start is untouched");
});

/**
 * #231: `first` puts a block at the top of the page. Each case starts from
 * `a` with one child `c`, and `z` at the top level, and lands `n` somewhere.
 */
test("first places a created block at the top of the page, and only on its own", () => {
  const created = (payload: object) =>
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "n", text: "new", ...payload });
  const start = [
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "a", text: "A" }),
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "c", text: "C", parent: "a" }),
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "z", text: "Z" }),
  ].reduce(reduce, empty());
  const shape = (blocks: Block[]): string =>
    blocks
      .map((it) => (it.children.length ? `${it.id}(${shape(it.children)})` : it.id))
      .join(" ");
  const cases: [string, object, string][] = [
    ["first alone: the top of the page", { first: true }, "n a(c) z"],
    ["with after: after places it", { first: true, after: "a" }, "a(c) n z"],
    ["with parent: parent places it", { first: true, parent: "a" }, "a(n c) z"],
    ["with a missing after: first is still ignored", { first: true, after: "gone" }, "a(c) z n"],
    ["false: the end of the page", { first: false }, "a(c) z n"],
    ["a string: the end of the page", { first: "yes" }, "a(c) z n"],
    ["a number: the end of the page", { first: 1 }, "a(c) z n"],
  ];
  for (const [name, payload, expected] of cases) {
    assert.equal(shape(getPage(reduce(start, created(payload)), TODAY).blocks), expected, name);
  }
  const alone = reduce(empty(), created({ first: true }));
  assert.equal(shape(getPage(alone, TODAY).blocks), "n", "an empty page");
});

test("without first, the block goes at the end: what an older build, which ignores it, shows", () => {
  const start = reduce(
    empty(),
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "a", text: "A" }),
  );
  const { first: _, ...older } = { page: TODAY, id: "n", text: "new", first: true };
  const folded = reduce(start, event(`${NAMESPACE}block.created`, 1, older));
  assert.deepEqual(getPage(folded, TODAY).blocks.map((it) => it.id), ["a", "n"]);
});

test("a prediction places a first block at the top as the fold does", () => {
  const page = { title: TODAY, blocks: [{ id: "a", text: "A", children: [] }] };
  const create: PageEvent = {
    type: `${NAMESPACE}block.created`,
    payload: { page: TODAY, id: "n", text: "new", first: true },
  };
  assert.deepEqual(predict(page, [create]).blocks.map((it) => it.id), ["n", "a"]);
});

test("a prediction places a block under its parent as the fold does", () => {
  const page = { title: TODAY, blocks: [{ id: "a", text: "A", children: [] }] };
  const create: PageEvent = {
    type: `${NAMESPACE}block.created`,
    payload: { page: TODAY, id: "n", text: "new", parent: "a" },
  };
  assert.deepEqual(predict(page, [create]).blocks[0].children.map((it) => it.id), ["n"]);
});

test("blockCreated writes the event's own type and v, and leaves off what is absent", () => {
  assert.deepEqual(blockCreated(TODAY, "x", undefined, "a"), {
    v: BLOCK_CREATED.v,
    type: BLOCK_CREATED.type,
    payload: { page: TODAY, id: "a", text: "x" },
  });
});

test("a creation reads an empty text, and refuses a missing one or a missing id", () => {
  assert.deepEqual(BLOCK_CREATED.parse({ page: "P", id: "a", text: "" }), { page: "P", id: "a", text: "" });
  assert.equal(BLOCK_CREATED.parse({ page: "P", id: "a" }), undefined);
  assert.equal(BLOCK_CREATED.parse({ page: "P", id: "", text: "x" }), undefined);
  assert.deepEqual(BLOCK_CREATED.parse({ page: 7, id: "a", text: "x" })?.page, "7", "filed under its String");
});

test("a creation is undone by a delete, and holds until someone writes under it", () => {
  const before = fold(empty(), blockCreated("Foo", "A", undefined, "a"));
  const made = blockCreated("Foo", "B", "a", "b");
  const after = fold(before, made);
  assert.deepEqual(invert(before, [made]), [blockDeleted("b")]);
  const step = remember(before, [made]);
  assert.equal(holds(after, step), true);
  assert.equal(holds(fold(after, blockCreated("Foo", "C", undefined, "c", "b")), step), false);
  assert.equal(holds(fold(after, blockEdited("b", "theirs")), step), false);
  assert.equal(holds(fold(after, blockEdited("a", "A!")), step), true, "a block it did not write");
});

// ── An id written twice (#273) ──────────────────────────────────────────────

/** Each page's blocks as `id:text`, nested, so a block shown twice shows. */
const shape = (graph: Graph, title: string): string => {
  const walk = (blocks: Block[]): string =>
    blocks.map((it) => `${it.id}:${it.text}${it.children.length ? `(${walk(it.children)})` : ""}`).join(" ");
  return walk(getPage(graph, title).blocks);
};

test("a create for an id the graph holds changes nothing: the first in fold order stands", () => {
  const before = fold(empty(), blockCreated(TODAY, "A", undefined, "a"));
  const first = fold(before, blockCreated(TODAY, "mine", "a", "x"));
  const second = fold(first, blockCreated("Elsewhere", "theirs", undefined, "x"));
  assert.equal(second, first, "the same state, so nothing reads it as a change");
  assert.equal(shape(second, TODAY), "a:A x:mine");
  assert.equal(shape(second, "Elsewhere"), "");
  // The other way round, the other one stands: order decides, the same on every machine.
  const other = fold(before, blockCreated("Elsewhere", "theirs", undefined, "x"), blockCreated(TODAY, "mine", "a", "x"));
  assert.equal(shape(other, TODAY), "a:A");
  assert.equal(shape(other, "Elsewhere"), "x:theirs");
});

test("a skipped create's children land under the block that holds the id", () => {
  const graph = fold(
    empty(),
    blockCreated(TODAY, "mine", undefined, "x"),
    blockCreated("Elsewhere", "theirs", undefined, "x"),
    blockCreated("Elsewhere", "child", undefined, "c", "x"),
  );
  assert.equal(shape(graph, TODAY), "x:mine(c:child)");
  assert.equal(shape(graph, "Elsewhere"), "");
});

test("a child follows its parent to the page it moved to before the child arrived", () => {
  const graph = fold(
    empty(),
    blockCreated(TODAY, "P", undefined, "p"),
    { type: `${NAMESPACE}block.moved`, v: 1, payload: { id: "p", page: "Elsewhere" } },
    // Written by a writer that still saw `p` on today's page.
    blockCreated(TODAY, "child", undefined, "c", "p"),
  );
  assert.equal(shape(graph, TODAY), "");
  assert.equal(shape(graph, "Elsewhere"), "p:P(c:child)");
});

test("a deleted id is not held, so it can be written again, at a new place", () => {
  const graph = fold(
    empty(),
    blockCreated(TODAY, "A", undefined, "a"),
    blockDeleted("a"),
    blockCreated("Elsewhere", "A again", undefined, "a"),
  );
  assert.equal(shape(graph, TODAY), "");
  assert.equal(shape(graph, "Elsewhere"), "a:A again");
});

test("two writers undoing the same delete show its blocks once", () => {
  const start = fold(
    empty(),
    blockCreated(TODAY, "A", undefined, "a"),
    blockCreated(TODAY, "child", undefined, "c", "a"),
  );
  const deleted = fold(start, blockDeleted("a"));
  const undo = invert(start, [blockDeleted("a")]) ?? [];
  assert.ok(undo.length > 0);
  // Each writer's undo, folded one after the other once they sync.
  const synced = fold(deleted, ...undo, ...undo);
  assert.equal(shape(synced, TODAY), "a:A(c:child)");
});

test("undo of a create another writer's earlier create beat stops, and deletes nothing", () => {
  const before = fold(empty(), blockCreated(TODAY, "A", undefined, "a"));
  const mine = blockCreated(TODAY, "mine", "a", "x");
  const step = remember(before, [mine]);
  // Theirs is earlier in fold order, so once synced, mine is the one skipped.
  const synced = fold(before, blockCreated("Elsewhere", "theirs", undefined, "x"), mine);
  assert.equal(holds(synced, step), false);
});
