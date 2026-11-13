/**
 * Run with: npm test
 *
 * The alias commands over a view whose `dispatch` folds into a held state,
 * with no log around it. Each test is its own composition root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getHeldAliases, graphFold } from "../graph.ts";
import type { Graph, GraphView } from "../graph.ts";
import { addAlias, removeAlias } from "./commands.ts";

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

test("addAlias writes the alias, once, in any spelling", async () => {
  const view = memory();
  await addAlias(view, "JavaScript", "JS");
  await addAlias(view, "javascript", " js ");
  assert.deepEqual(view.written, [{ type: "alias.added", payload: { page: "JavaScript", alias: "JS" } }]);
  assert.deepEqual(getHeldAliases(view.state, "JavaScript"), [{ alias: "JS" }]);
});

test("an alias another rule keeps from opening the page is written all the same", async () => {
  const view = memory();
  await addAlias(view, "Python", "JS");
  await addAlias(view, "Snake", "JS");
  assert.equal(view.written.length, 2);
});

test("the page's own title, a date and a blank name are refused and write nothing", async () => {
  const view = memory();
  await assert.rejects(addAlias(view, "JavaScript", " javascript"));
  await assert.rejects(addAlias(view, "Election", "2024-11-04"));
  await assert.rejects(addAlias(view, "JavaScript", "  "));
  await assert.rejects(addAlias(view, "", "JS"));
  await assert.rejects(removeAlias(view, "JavaScript", ""));
  assert.deepEqual(view.written, []);
});

test("removeAlias writes the removal, and removing one the page lacks writes nothing", async () => {
  const view = memory();
  await addAlias(view, "JavaScript", "JS");
  await removeAlias(view, "JavaScript", "ECMAScript");
  assert.equal(view.written.length, 1);
  await removeAlias(view, "JAVASCRIPT", "js");
  assert.deepEqual(view.written.at(-1), { type: "alias.removed", payload: { page: "JAVASCRIPT", alias: "js" } });
  assert.deepEqual(getHeldAliases(view.state, "JavaScript"), []);
});
