/**
 * Run with: npm test
 *
 * `block.edited` on its own: what it reads, how it is written, and how it is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphFold, holds, invert } from "../../../graph.ts";
import type { Batched, Graph } from "../../../graph.ts";
import { blockCreated } from "../created/created.ts";
import { blockOutdented } from "../outdented/outdented.ts";
import { BLOCK_EDITED, blockEdited } from "./edited.ts";

const TODAY = "2026-09-21";

/** Nothing written yet: the fold's own start, so it has every field `Graph` does. */
const empty = (): Graph => graphFold.initial;


/** `events` folded onto `state`, through the gate. */
const fold = (state: Graph, ...events: Batched[]): Graph => events.reduce(graphFold.reduce, state);

test("blockEdited writes the event's own type and v", () => {
  assert.deepEqual(blockEdited("a", "x"), { v: BLOCK_EDITED.v, type: BLOCK_EDITED.type, payload: { id: "a", text: "x" } });
});

test("an edit reads an empty text and a v1 payload's page, and refuses a missing text", () => {
  assert.deepEqual(BLOCK_EDITED.parse({ id: "a", text: "" }), { id: "a", text: "" });
  assert.deepEqual(BLOCK_EDITED.parse({ page: TODAY, id: "a", text: "x" }), { id: "a", text: "x" });
  assert.equal(BLOCK_EDITED.parse({ id: "a" }), undefined);
});

test("an edit is undone back to the old text, and not at all when the text was the same", () => {
  const before = fold(empty(), blockCreated("Foo", "A", undefined, "a"));
  assert.deepEqual(invert(before, [blockEdited("a", "A!")]), [blockEdited("a", "A")]);
  assert.deepEqual(invert(before, [blockEdited("a", "A")]), []);
  assert.deepEqual(invert(before, [blockEdited("gone", "x")]), [], "a block the graph lacks");
});

test("an edit holds until someone else changes the text, and through a move", () => {
  const before = fold(
    empty(),
    blockCreated("Foo", "A", undefined, "a"),
    blockCreated("Foo", "B", undefined, "b", "a"),
  );
  const after = fold(before, blockEdited("b", "B!"));
  const step = { before, events: [blockEdited("b", "B!")], after };
  assert.equal(holds(fold(after, blockOutdented({ id: "b", after: "a" })), step), true);
  assert.equal(holds(fold(after, blockEdited("b", "theirs")), step), false);
});
