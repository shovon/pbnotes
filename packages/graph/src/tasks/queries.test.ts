/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockCreated, graphFold } from "../graph.ts";
import type { Graph } from "../graph.ts";
import { getTasks } from "./queries.ts";
import type { Marker } from "./tasks.ts";

/** A graph holding `blocks`, each `[page, id, text, parent?]`, created in order. */
function graph(blocks: [string, string, string, string?][]): Graph {
  let after = new Map<string, string>();
  return blocks.reduce((state, [page, id, text, parent]) => {
    const key = `${page}/${parent ?? ""}`;
    const event = blockCreated(page, text, after.get(key), id, parent);
    after = new Map(after).set(key, id);
    return graphFold.reduce(state, { ...event, payload: event.payload });
  }, graphFold.initial);
}

const ALL = new Set<Marker>(["TODO", "DOING", "DONE"]);
const titles = (state: Graph, markers = ALL) =>
  getTasks(state, markers).pages.map((page) => [page.title, page.blocks.map((it) => it.text)]);

test("a page's tasks are cut out of it, and its other blocks left out", () => {
  const state = graph([
    ["Kitchen", "a", "TODO order tiles"],
    ["Kitchen", "b", "the tiles are blue"],
    ["Kitchen", "c", "DONE measure the floor"],
  ]);
  assert.deepEqual(titles(state), [["Kitchen", ["TODO order tiles", "DONE measure the floor"]]]);
});

test("a page with no task is not listed", () => {
  const state = graph([
    ["Kitchen", "a", "TODOs to sort"],
    ["Garden", "b", "todo later"],
  ]);
  assert.deepEqual(getTasks(state, ALL), { pages: [], shown: 0, total: 0 });
});

test("pages are in the order they are listed: days newest first, then named pages A to Z", () => {
  const state = graph([
    ["Zebra", "a", "TODO z"],
    ["2026-11-12", "b", "TODO older day"],
    ["Apple", "c", "TODO a"],
    ["2026-11-13", "d", "TODO newer day"],
  ]);
  assert.deepEqual(
    titles(state).map(([title]) => title),
    ["2026-11-13", "2026-11-12", "Apple", "Zebra"],
  );
});

test("a task comes with everything under it, and a task inside it shows only there", () => {
  const state = graph([
    ["Kitchen", "a", "DOING sand the wall"],
    ["Kitchen", "b", "start from the window", "a"],
    ["Kitchen", "c", "TODO buy sandpaper", "a"],
  ]);
  const { pages, shown, total } = getTasks(state, ALL);
  assert.equal(pages[0].blocks.length, 1);
  assert.deepEqual(
    pages[0].blocks[0].children.map((it) => it.text),
    ["start from the window", "TODO buy sandpaper"],
  );
  assert.equal(shown, 2);
  assert.equal(total, 2);
});

test("a task under a block that is not one is taken where it is", () => {
  const state = graph([
    ["Kitchen", "a", "Walls"],
    ["Kitchen", "b", "TODO sand the south wall", "a"],
  ]);
  assert.deepEqual(titles(state), [["Kitchen", ["TODO sand the south wall"]]]);
});

test("only the markers asked for are taken, and the total counts every task", () => {
  const state = graph([
    ["Kitchen", "a", "TODO order tiles"],
    ["Kitchen", "b", "DOING sand the wall"],
    ["Kitchen", "c", "DONE measure the floor"],
    ["Garden", "d", "DONE plant the bulbs"],
  ]);
  const open = getTasks(state, new Set<Marker>(["TODO", "DOING"]));
  assert.deepEqual(
    open.pages.map((page) => [page.title, page.blocks.map((it) => it.text)]),
    [["Kitchen", ["TODO order tiles", "DOING sand the wall"]]],
  );
  assert.equal(open.shown, 2);
  assert.equal(open.total, 4);
});

test("a task left out by the filter still lets the ones under it show", () => {
  const state = graph([
    ["Kitchen", "a", "DONE paint the ceiling"],
    ["Kitchen", "b", "TODO touch up the corner", "a"],
  ]);
  assert.deepEqual(titles(state, new Set<Marker>(["TODO"])), [["Kitchen", ["TODO touch up the corner"]]]);
});

test("no markers asked for shows nothing, and still counts every task", () => {
  const state = graph([["Kitchen", "a", "TODO order tiles"]]);
  assert.deepEqual(getTasks(state, new Set()), { pages: [], shown: 0, total: 1 });
});
