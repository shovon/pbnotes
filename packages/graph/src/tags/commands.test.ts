/**
 * Run with: npm test
 *
 * The tag commands over a view whose `dispatch` folds into a held state, with
 * no log around it. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTags, graphFold } from "../graph.ts";
import type { Graph, GraphView } from "../graph.ts";
import { addTag, removeTag } from "./commands.ts";

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

test("addTag writes the tag and hands back the page's tags", async () => {
  const view = memory();
  assert.deepEqual(await addTag(view, "Foo", "Work"), ["Work"]);
  assert.deepEqual(view.written, [{ type: "tag.added", payload: { page: "Foo", tag: "Work" } }]);
  assert.deepEqual(await addTag(view, "Foo", "Home"), ["Home", "Work"]);
});

test("adding a tag the page has writes nothing, in any spelling", async () => {
  const view = memory();
  await addTag(view, "Foo", "Work");
  assert.deepEqual(await addTag(view, "foo", " work "), ["Work"]);
  assert.equal(view.written.length, 1);
});

test("removeTag writes the removal, and removing a tag the page lacks writes nothing", async () => {
  const view = memory();
  await addTag(view, "Foo", "Work");
  assert.deepEqual(await removeTag(view, "Foo", "Home"), ["Work"]);
  assert.equal(view.written.length, 1);
  assert.deepEqual(await removeTag(view, "FOO", "work"), []);
  assert.deepEqual(view.written.at(-1), { type: "tag.removed", payload: { page: "FOO", tag: "work" } });
  assert.deepEqual(await removeTag(view, "Foo", "Work"), []);
  assert.equal(view.written.length, 2);
});

test("a blank page or tag is refused and writes nothing", async () => {
  const view = memory();
  await assert.rejects(addTag(view, " ", "Work"));
  await assert.rejects(addTag(view, "Foo", ""));
  await assert.rejects(removeTag(view, "", "Work"));
  await assert.rejects(removeTag(view, "Foo", "  "));
  assert.deepEqual(view.written, []);
  assert.deepEqual(getTags(view.state, "Foo"), []);
});
