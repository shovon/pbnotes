/**
 * Run with: npm test
 *
 * `renamePage`: what it writes, and what it refuses before writing anything.
 * What a rename does to the graph is `renamed/renamed.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasAdded, blockCreated, getPage, graphFold, renamePage } from "../graph.ts";
import type { Batched, Graph, GraphView } from "../graph.ts";

/** A view over a plain list of events, folded through the gate, starting from `events`. */
function memory(...start: Batched[]): GraphView & { events: unknown[] } {
  const events: unknown[] = [];
  let state: Graph = start.reduce(graphFold.reduce, graphFold.initial);
  return {
    events,
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      const event = { type, v, payload };
      events.push(event);
      state = graphFold.reduce(state, event);
    },
  };
}

test("renames the page a name opens, as one event, and answers with its new title", async () => {
  const view = memory(blockCreated("JavaScript", "x", undefined, "x"), aliasAdded("JavaScript", "JS"));
  assert.equal(await renamePage(view, "JS", "ECMAScript"), "ECMAScript");
  assert.equal(view.events.length, 1);
  assert.deepEqual((view.events[0] as { payload: unknown }).payload, { from: "JavaScript", to: "ECMAScript" });
  assert.equal(getPage(view.state, "JavaScript").title, "ECMAScript");
});

test("a rename to the spelling the page has writes nothing", async () => {
  const view = memory(blockCreated("Mira", "x", undefined, "x"));
  assert.equal(await renamePage(view, "mira", "Mira"), "Mira");
  assert.equal(view.events.length, 0);
});

test("refuses, writing nothing, what the fold would skip", async () => {
  const view = memory(
    blockCreated("A", "x", undefined, "x"),
    blockCreated("B", "y", undefined, "y"),
    blockCreated("JavaScript", "z", undefined, "z"),
    aliasAdded("JavaScript", "JS"),
  );
  await assert.rejects(renamePage(view, "A", "b"), /“B” already has content/);
  await assert.rejects(renamePage(view, "A", "JS"), /already opens another page/);
  await assert.rejects(renamePage(view, "A", " "), /needs a title/);
  await assert.rejects(renamePage(view, "A", "x ]] y"), /can't hold/);
  await assert.rejects(renamePage(view, "A", "x\ny"), /can't hold/);
  assert.equal(view.events.length, 0);
});

test("renaming back onto a name the page left behind goes through", async () => {
  const view = memory(blockCreated("A", "x", undefined, "x"));
  await renamePage(view, "A", "B");
  assert.equal(await renamePage(view, "B", "A"), "A");
  assert.equal(getPage(view.state, "B").title, "A");
});

test("a page with nothing on it but links to it is renamed, and the links follow", async () => {
  const view = memory(blockCreated("Notes", "met [[Bridal Falls]] and #[[bridal falls]]", undefined, "n"));
  assert.equal(await renamePage(view, "Bridal Falls", "Waterfall"), "Waterfall");
  assert.equal(view.events.length, 1);
  assert.deepEqual(
    getPage(view.state, "Notes").blocks.map((it) => it.text),
    ["met [[Waterfall]] and #[[Waterfall]]"],
  );
  assert.equal(getPage(view.state, "Bridal Falls").title, "Waterfall");
});

test("a page nothing is on and nothing names is renamed by writing nothing", async () => {
  const view = memory(blockCreated("Notes", "nothing here", undefined, "n"));
  assert.equal(await renamePage(view, "Untitled", "Plans"), "Plans");
  assert.equal(view.events.length, 0);
});
