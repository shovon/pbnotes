/**
 * Run with: npm test
 *
 * The icon commands over a view whose `dispatch` folds into a held state, with
 * no log around it. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getIcon, graphFold } from "../graph.ts";
import type { Graph, GraphView } from "../graph.ts";
import { removeIcon, setIcon } from "./commands.ts";

/** A view over a held state, and every event it was handed, in order. */
function memory(): GraphView & { written: { type: string; payload: unknown }[] } {
  let state: Graph = graphFold.initial;
  const written: { type: string; payload: unknown }[] = [];
  return {
    written,
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      written.push({ type: type.split("#")[1], payload });
      state = graphFold.reduce(state, { type, v, payload });
    },
  };
}

test("setIcon writes the icon and hands it back", async () => {
  const view = memory();
  assert.equal(await setIcon(view, "Foo", "🌲"), "🌲");
  assert.deepEqual(view.written, [{ type: "icon.set", payload: { page: "Foo", icon: "🌲" } }]);
  assert.equal(await setIcon(view, "Foo", "🌊"), "🌊");
  assert.equal(getIcon(view.state, "Foo"), "🌊");
});

test("setting the icon the page has writes nothing, in any spelling of the page", async () => {
  const view = memory();
  await setIcon(view, "Foo", "🌲");
  assert.equal(await setIcon(view, "FOO", "🌲"), "🌲");
  assert.equal(view.written.length, 1);
});

test("removeIcon writes the removal, and removing an icon the page lacks writes nothing", async () => {
  const view = memory();
  assert.equal(await removeIcon(view, "Foo"), undefined);
  assert.deepEqual(view.written, []);
  await setIcon(view, "Foo", "🌲");
  assert.equal(await removeIcon(view, "foo"), undefined);
  assert.deepEqual(view.written.at(-1), { type: "icon.removed", payload: { page: "foo" } });
  assert.equal(getIcon(view.state, "Foo"), undefined);
});

test("a blank page is refused and writes nothing", async () => {
  const view = memory();
  await assert.rejects(setIcon(view, " ", "🌲"));
  await assert.rejects(removeIcon(view, ""));
  assert.deepEqual(view.written, []);
});
