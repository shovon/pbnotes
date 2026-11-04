/**
 * Run with: npm test
 *
 * `block.outdented` on its own: how it is written, and how it is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPage, graphFold, holds, invert } from "../../graph.ts";
import type { Batched, Graph } from "../../graph.ts";
import { blockCreated } from "../created/created.ts";
import { blockIndented } from "../indented/indented.ts";
import { BLOCK_OUTDENTED, blockOutdented } from "./outdented.ts";

/** Nothing written yet: the fold's own start, so it has every field `Graph` does. */
const empty = (): Graph => graphFold.initial;


/** `events` folded onto `state`, through the gate. */
const fold = (state: Graph, ...events: Batched[]): Graph => events.reduce(graphFold.reduce, state);

/** `Foo`: `a` with children `a1`, `a2` and `a3`. */
const FOO = fold(
  empty(),
  blockCreated("Foo", "A", undefined, "a"),
  blockCreated("Foo", "A1", undefined, "a1", "a"),
  blockCreated("Foo", "A2", "a1", "a2", "a"),
  blockCreated("Foo", "A3", "a2", "a3", "a"),
);

test("blockOutdented writes the event's own type and v", () => {
  assert.deepEqual(blockOutdented({ id: "a1", after: "a" }), {
    v: BLOCK_OUTDENTED.v,
    type: BLOCK_OUTDENTED.type,
    payload: { id: "a1", after: "a" },
  });
});

test("an outdent is undone by an indent, then an outdent for each sibling it took along, last first", () => {
  const out = blockOutdented({ id: "a1", after: "a" });
  const inverse = invert(FOO, [out]);
  assert.deepEqual(inverse, [
    blockIndented({ id: "a1", parent: "a" }),
    blockOutdented({ id: "a3", after: "a1" }),
    blockOutdented({ id: "a2", after: "a1" }),
  ]);
  const back = fold(fold(FOO, out), ...(inverse ?? []));
  assert.deepEqual(getPage(back, "Foo").blocks, getPage(FOO, "Foo").blocks);
});

test("an outdent holds until the block or a sibling it took along moves again", () => {
  const out = blockOutdented({ id: "a1", after: "a" });
  const step = { before: FOO, events: [out], after: fold(FOO, out) };
  assert.equal(holds(step.after, step), true);
  assert.equal(holds(fold(step.after, blockOutdented({ id: "a2", after: "a1" })), step), false);
});
