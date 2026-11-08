/**
 * Run with: npm test
 *
 * `icon.removed` on its own: what it folds to, how it is written, and how it
 * is undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../../events.ts";
import { getIcon, graphFold, holds, invert, remember } from "../../../graph.ts";
import type { Graph } from "../../../graph.ts";
import { ICON_REMOVED, iconRemoved } from "./removed.ts";
import { iconSet } from "../set/set.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

test("a removed takes the icon away, in any spelling of the page", () => {
  assert.equal(getIcon(fold([iconSet("Foo", "🌲"), iconRemoved("FOO")]), "Foo"), undefined);
});

test("removing an icon the page lacks changes nothing", () => {
  const before = fold([iconSet("Bar", "🌲"), iconSet("Foo", "x"), iconRemoved("Foo")]);
  assert.equal(graphFold.reduce(before, iconRemoved("foo")), before);
});

test("a malformed removed is skipped whole", () => {
  const before = fold([iconSet("Foo", "🌲")]);
  for (const payload of [null, {}, { page: "" }, { page: 1 }]) {
    const state = graphFold.reduce(before, { type: `${NAMESPACE}icon.removed`, v: 1, payload });
    assert.equal(state, before, JSON.stringify(payload));
  }
});

test("iconRemoved writes the event's own type and v", () => {
  assert.deepEqual(iconRemoved("Foo"), {
    v: ICON_REMOVED.v,
    type: ICON_REMOVED.type,
    payload: { page: "Foo" },
  });
});

test("a removed is undone by setting the icon back, and not at all when there was none", () => {
  const before = fold([iconSet("Foo", "🌲")]);
  assert.deepEqual(invert(before, [iconRemoved("Foo")]), [iconSet("Foo", "🌲")]);
  assert.deepEqual(invert(graphFold.initial, [iconRemoved("Foo")]), []);
});

test("a removed holds until someone sets an icon again", () => {
  const before = fold([iconSet("Foo", "🌲")]);
  const after = fold([iconRemoved("Foo")], before);
  const step = remember(before, [iconRemoved("Foo")]);
  assert.equal(holds(after, step), true);
  assert.equal(holds(fold([iconSet("Foo", "🌊")], after), step), false);
});
