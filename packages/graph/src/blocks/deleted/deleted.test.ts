/**
 * Run with: npm test
 *
 * `block.deleted` on its own: how it is written, and how it is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPage, graphFold, holds, invert } from "../../graph.ts";
import type { Batched, Graph } from "../../graph.ts";
import { blockCreated } from "../created/created.ts";
import { BLOCK_DELETED, blockDeleted } from "./deleted.ts";

/** Nothing written yet: the fold's own start, so it has every field `Graph` does. */
const empty = (): Graph => graphFold.initial;


/** `events` folded onto `state`, through the gate. */
const fold = (state: Graph, ...events: Batched[]): Graph => events.reduce(graphFold.reduce, state);

/** `Foo`: `a` with children `a1` and `a2`, then `b`. */
const FOO = fold(
  empty(),
  blockCreated("Foo", "A", undefined, "a"),
  blockCreated("Foo", "A1", undefined, "a1", "a"),
  blockCreated("Foo", "A2", "a1", "a2", "a"),
  blockCreated("Foo", "B", "a", "b"),
);

test("blockDeleted writes the event's own type and v", () => {
  assert.deepEqual(blockDeleted("a"), { v: BLOCK_DELETED.v, type: BLOCK_DELETED.type, payload: { id: "a" } });
});

test("a delete is undone by writing the subtree back, same ids, in place", () => {
  const inverse = invert(FOO, [blockDeleted("a")]);
  assert.deepEqual(inverse, [
    blockCreated("Foo", "A", undefined, "a", undefined, true),
    blockCreated("Foo", "A1", undefined, "a1", "a"),
    blockCreated("Foo", "A2", "a1", "a2", "a"),
  ]);
  const back = fold(fold(FOO, blockDeleted("a")), ...(inverse ?? []));
  assert.deepEqual(getPage(back, "Foo").blocks, getPage(FOO, "Foo").blocks);
  assert.deepEqual(invert(FOO, [blockDeleted("gone")]), [], "a block the graph lacks");
});

test("a delete holds until one of its ids comes back", () => {
  const after = fold(FOO, blockDeleted("a"));
  const step = { before: FOO, events: [blockDeleted("a")], after };
  assert.equal(holds(fold(after, blockCreated("Foo", "new", undefined, "n")), step), true);
  assert.equal(holds(fold(after, blockCreated("Foo", "A2", undefined, "a2")), step), false);
});
