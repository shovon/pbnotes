/**
 * Run with: npm test
 *
 * `page.deleted` on its own: what it reads, how it is written, and how it is
 * undone. What a delete does to the rest of the graph is `deletes.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliasAdded,
  blockCreated,
  blockEdited,
  getPage,
  graphFold,
  holds,
  invert,
  NAMESPACE,
  propertySet,
  remember,
  tagAdded,
} from "../../graph.ts";
import type { Batched, Graph } from "../../graph.ts";
import { PAGE_DELETED, pageDeleted } from "./deleted.ts";
import { get } from "../../immutable/immutable.ts";

/** `events` folded onto `state`. */
const fold = (state: Graph, ...events: Batched[]): Graph => events.reduce(graphFold.reduce, state);

/** `Foo`: `a` with a child `b`, then `c`; a property, a tag and an alias. */
const FOO = fold(
  graphFold.initial,
  blockCreated("Foo", "A", undefined, "a"),
  blockCreated("Foo", "B", undefined, "b", "a"),
  blockCreated("Foo", "C", "a", "c"),
  propertySet("Foo", "Owner", "Mira"),
  tagAdded("Foo", "Work"),
  aliasAdded("Foo", "F"),
);

test("a malformed delete is skipped whole", () => {
  const state = graphFold.reduce(
    graphFold.initial,
    blockCreated("Foo", "x", undefined, "x"),
  );
  for (const payload of [null, "Foo", {}, { page: 7 }, { page: "  " }]) {
    const event = { type: `${NAMESPACE}page.deleted`, v: 1, payload };
    assert.equal(graphFold.reduce(state, event), state, JSON.stringify(payload));
  }
});

test("pageDeleted writes the event's own type and v", () => {
  assert.deepEqual(pageDeleted("Foo"), {
    v: PAGE_DELETED.v,
    type: PAGE_DELETED.type,
    payload: { page: "Foo" },
  });
});

test("a delete is undone in one batch: blocks in place, then properties, tags and aliases", () => {
  const inverse = invert(FOO, [pageDeleted("foo")]);
  assert.ok(inverse);
  assert.deepEqual(
    inverse.map((it) => it.type.slice(NAMESPACE.length)),
    ["block.created", "block.created", "block.created", "property.set", "tag.added", "alias.added"],
  );
  const back = fold(fold(FOO, pageDeleted("foo")), ...inverse);
  assert.deepEqual(getPage(back, "Foo").blocks, getPage(FOO, "Foo").blocks);
  assert.deepEqual(
    [get(back.properties, "foo"), get(back.tags, "foo"), get(back.aliases, "foo")],
    [get(FOO.properties, "foo"), get(FOO.tags, "foo"), get(FOO.aliases, "foo")],
  );
  assert.ok(inverse.every((it) => (it.payload as { page: string }).page === "Foo"), "spelled as it was");
});

test("a delete holds until one of its blocks comes back, and not because the page gained one", () => {
  const after = fold(FOO, pageDeleted("Foo"));
  const step = remember(FOO, [pageDeleted("Foo")]);
  assert.equal(holds(fold(after, blockCreated("Foo", "new", undefined, "n")), step), true);
  assert.equal(holds(fold(after, blockCreated("Foo", "A", undefined, "a")), step), false);
  assert.equal(holds(fold(after, blockEdited("x", "y")), step), true, "an unrelated change");
});
