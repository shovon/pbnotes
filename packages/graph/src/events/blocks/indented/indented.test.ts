/**
 * Run with: npm test
 *
 * `block.indented` on its own: what it refuses, how it is written, and how it is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../../events.ts";
import { graphFold, holds, invert } from "../../../graph.ts";
import type { Batched, Graph } from "../../../graph.ts";
import { reduce } from "../slice.ts";
import { blockCreated } from "../created/created.ts";
import { blockEdited } from "../edited/edited.ts";
import { blockOutdented } from "../outdented/outdented.ts";
import { BLOCK_INDENTED, blockIndented } from "./indented.ts";

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
 * #62: two machines each indent one block under the other before they sync.
 * The second move would detach its own parent, so it folds to nothing, like
 * an indent whose parent is gone.
 */
test("an indent under itself or its own subtree changes nothing", () => {
  const indent = (id: string, parent: string) =>
    event(`${NAMESPACE}block.indented`, 2, { id, parent });
  const two = [
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "x", text: "x" }),
    event(`${NAMESPACE}block.created`, 1, { page: TODAY, id: "y", text: "y" }),
  ].reduce(reduce, empty());

  assert.equal(reduce(two, indent("y", "y")), two);
  const nested = reduce(two, indent("y", "x"));
  assert.equal(reduce(nested, indent("x", "y")), nested);
});

test("blockIndented writes the event's own type and v", () => {
  assert.deepEqual(blockIndented({ id: "b", parent: "a" }), {
    v: BLOCK_INDENTED.v,
    type: BLOCK_INDENTED.type,
    payload: { id: "b", parent: "a" },
  });
});

test("an indent under the sibling above is undone by an outdent after it; elsewhere, not at all", () => {
  const before = fold(
    empty(),
    blockCreated("Foo", "A", undefined, "a"),
    blockCreated("Foo", "B", "a", "b"),
    blockCreated("Foo", "C", "b", "c"),
  );
  assert.deepEqual(invert(before, [blockIndented({ id: "b", parent: "a" })]), [
    blockOutdented({ id: "b", after: "a" }),
  ]);
  assert.equal(invert(before, [blockIndented({ id: "c", parent: "a" })]), undefined);
});

test("an indent holds until the block moves again", () => {
  const before = fold(empty(), blockCreated("Foo", "A", undefined, "a"), blockCreated("Foo", "B", "a", "b"));
  const step = { before, events: [blockIndented({ id: "b", parent: "a" })], after: fold(before, blockIndented({ id: "b", parent: "a" })) };
  assert.equal(holds(fold(step.after, blockEdited("b", "B!")), step), true, "a text change");
  assert.equal(holds(fold(step.after, blockOutdented({ id: "b", after: "a" })), step), false);
});
