/**
 * Run with: npm test
 *
 * `icon.set` on its own: what it folds to, how it is written, and how it is
 * undone. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMESPACE } from "../../event/event.ts";
import { getIcon, graphFold, holds, invert, remember } from "../../graph.ts";
import type { Graph } from "../../graph.ts";
import { ICON_SET, iconSet } from "./set.ts";
import { iconRemoved } from "../removed/removed.ts";
import { get } from "../../immutable/immutable.ts";

type Event = { type: string; v: number; at?: string; payload: unknown };

/** `events` folded in order from nothing, through the gate. */
const fold = (events: Event[], from: Graph = graphFold.initial): Graph =>
  events.reduce(graphFold.reduce, from);

const raw = (payload: unknown): Event => ({ type: `${NAMESPACE}icon.set`, v: 1, payload });

test("a set gives the page that icon, and names the page", () => {
  const state = fold([iconSet("Foo", "🌲")]);
  assert.equal(getIcon(state, "foo"), "🌲");
  assert.equal(get(state.titles, "foo"), "Foo");
});

test("an icon is any string, \"\" included: what it means is the reader's", () => {
  assert.equal(getIcon(fold([iconSet("Foo", "image:abc123")]), "Foo"), "image:abc123");
  assert.equal(getIcon(fold([iconSet("Foo", "not an emoji at all")]), "Foo"), "not an emoji at all");
  assert.equal(getIcon(fold([iconSet("Foo", "")]), "Foo"), "");
});

test("the later set wins, so either fold order ends with the one folded last", () => {
  assert.equal(getIcon(fold([iconSet("Foo", "🌲"), iconSet("foo", "🌊")]), "Foo"), "🌊");
  assert.equal(getIcon(fold([iconSet("foo", "🌊"), iconSet("Foo", "🌲")]), "Foo"), "🌲");
});

test("a malformed set is skipped whole, and extra fields are ignored", () => {
  for (const payload of [
    null,
    "Foo",
    {},
    { page: "Foo" },
    { page: "Foo", icon: 1 },
    { page: "Foo", icon: null },
    { page: " ", icon: "🌲" },
    { page: 1, icon: "🌲" },
  ]) {
    assert.equal(fold([raw(payload)]), graphFold.initial, JSON.stringify(payload));
  }
  assert.equal(getIcon(fold([raw({ page: "Foo", icon: "🌲", size: "big" })]), "Foo"), "🌲");
});

test("a set leaves blocks, properties, tags and aliases as they were", () => {
  const state = fold([iconSet("Foo", "🌲")]);
  const { forest, texts, properties, tags, aliases } = graphFold.initial;
  assert.deepEqual(
    [state.forest, state.texts, state.properties, state.tags, state.aliases],
    [forest, texts, properties, tags, aliases],
  );
});

test("iconSet writes the event's own type and v", () => {
  assert.deepEqual(iconSet("Foo", "🌲"), {
    v: ICON_SET.v,
    type: ICON_SET.type,
    payload: { page: "Foo", icon: "🌲" },
  });
});

test("a set is undone back to the icon before, or removed if there was none", () => {
  const before = fold([iconSet("Foo", "🌲")]);
  assert.deepEqual(invert(before, [iconSet("Foo", "🌊")]), [iconSet("Foo", "🌲")]);
  assert.deepEqual(invert(graphFold.initial, [iconSet("Foo", "🌊")]), [iconRemoved("Foo")]);
  assert.deepEqual(invert(before, [iconSet("foo", "🌲")]), [], "already had it");
});

test("a set holds until someone else changes the icon", () => {
  const after = fold([iconSet("Foo", "🌲")]);
  const step = remember(graphFold.initial, [iconSet("Foo", "🌲")]);
  assert.equal(holds(fold([iconSet("Bar", "🌊")], after), step), true, "another page");
  assert.equal(holds(fold([iconSet("Foo", "🌊")], after), step), false);
  assert.equal(holds(fold([iconRemoved("Foo")], after), step), false);
});
