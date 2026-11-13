/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockCreated, graphFold } from "@pbnotes/graph";
import type { Graph } from "@pbnotes/graph";
import { CUTS } from "../place-view/place-view.ts";
import { getTaskView } from "./task-view.ts";

/** The fold over `events`, as a ledger would hold it, at version 7. */
function folded(...events: { type: string; v: number; payload: unknown }[]) {
  const state: Graph = events.reduce(graphFold.reduce, graphFold.initial);
  return { state, version: 7 };
}

const titles = (view: { pages: { title: string }[] }) => view.pages.map((page) => page.title);

test("the tasks are labelled with the version they were read at, and counted", () => {
  const view = getTaskView(
    folded(
      blockCreated("Kitchen", "TODO order tiles", undefined, "a"),
      blockCreated("Kitchen", "DONE measure the floor", "a", "b"),
      blockCreated("Garden", "not a task", undefined, "c"),
    ),
    [{ kind: "marker", markers: ["TODO", "DOING"] }],
  );
  assert.equal(view.version, 7);
  assert.deepEqual(titles(view), ["Kitchen"]);
  assert.deepEqual(view.pages[0].blocks.map((it) => it.text), ["TODO order tiles"]);
  assert.equal(view.shown, 1);
  assert.equal(view.total, 2);
});

test("no filter shows every task", () => {
  const view = getTaskView(
    folded(
      blockCreated("Kitchen", "TODO order tiles", undefined, "a"),
      blockCreated("Kitchen", "DONE measure the floor", "a", "b"),
    ),
    [],
  );
  assert.equal(view.shown, 2);
  assert.equal(view.pages[0].blocks.length, 2);
});

test("what a task quotes comes with it", () => {
  const view = getTaskView(
    folded(
      blockCreated("Notes", "the quote is 400", undefined, "q"),
      blockCreated("Kitchen", "TODO reply about ((q))", undefined, "a"),
    ),
    [],
  );
  assert.deepEqual(view.previews, [["q", "the quote is 400"]]);
});

test("the first chunk of pages loads without asking, and the next is asked for by its last title", () => {
  const pages = Array.from({ length: CUTS + 5 }, (_, i) => `Page ${String(i).padStart(2, "0")}`);
  const state = folded(...pages.map((page, i) => blockCreated(page, "TODO something", undefined, `b${i}`)));

  const first = getTaskView(state, []);
  assert.deepEqual(titles(first), pages.slice(0, CUTS));
  assert.deepEqual(first.list, { through: pages[CUTS - 1], next: pages.at(-1) });
  assert.equal(first.shown, CUTS + 5);

  const more = getTaskView(state, [], first.list.next ?? undefined);
  assert.deepEqual(titles(more), pages);
  assert.deepEqual(more.list, { through: pages.at(-1), next: null });
});

test("nothing to show is an empty first chunk with nothing after it", () => {
  const view = getTaskView(folded(), []);
  assert.deepEqual(view.pages, []);
  assert.deepEqual(view.list, { through: null, next: null });
  assert.equal(view.total, 0);
});
