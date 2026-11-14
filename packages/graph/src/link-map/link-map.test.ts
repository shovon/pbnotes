import { test } from "node:test";
import assert from "node:assert/strict";
import { addAlias, addBlock, addTag, graphFold, indentBlock } from "../graph.ts";
import type { Graph, GraphView } from "../graph.ts";
import { blockNode, getLinkMap, getPreviewsOf, pageNode, project } from "./link-map.ts";

function memory(): GraphView {
  let state: Graph = graphFold.initial;
  return {
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      state = graphFold.reduce(state, { type, v, payload });
    },
  };
}

/** Mira: m1 links Oslo, m2 under it refs o1. Oslo: o1. Book tags Oslo; JS is an alias of Oslo. */
async function sample(): Promise<GraphView> {
  const view = memory();
  await addBlock(view, "Mira", "about [[Oslo]] and [[Oslo]]", undefined, "m1");
  await addBlock(view, "Mira", "see ((o1)) and ((nope))", "m1", "m2");
  await indentBlock(view, "m2");
  await addBlock(view, "Oslo", "the city", undefined, "o1");
  await addAlias(view, "Oslo", "JS");
  await addBlock(view, "Mira", "also [[JS]]", "m1", "m3");
  await addTag(view, "Book", "Oslo");
  return view;
}

test("getLinkMap: every page with its outline, every arrow at the end it was written at", async () => {
  const { state } = await sample();
  const linkMap = getLinkMap(state);
  assert.deepEqual(
    linkMap.pages.map(({ title, forest }) => ({ title, forest })),
    [
      { title: "Book", forest: [] },
      {
        title: "Mira",
        forest: [
          { id: "m1", children: [{ id: "m2", children: [] }] },
          { id: "m3", children: [] },
        ],
      },
      { title: "Oslo", forest: [{ id: "o1", children: [] }] },
    ],
  );
  assert.deepEqual(linkMap.edges, [
    // Linked twice, one arrow.
    { from: { page: "Mira", block: "m1" }, to: { page: "Oslo" }, kind: "link" },
    // A ref to a block the project lacks is left out.
    { from: { page: "Mira", block: "m2" }, to: { page: "Oslo", block: "o1" }, kind: "ref" },
    // The alias opens Oslo.
    { from: { page: "Mira", block: "m3" }, to: { page: "Oslo" }, kind: "link" },
    { from: { page: "Book" }, to: { page: "Oslo" }, kind: "tag" },
  ]);
});

test("project: all closed is page to page, arrows merged", async () => {
  const projected = project(getLinkMap((await sample()).state), new Set());
  assert.deepEqual(
    projected.nodes.map(({ id, size }) => [id, size]),
    [
      [pageNode("Book"), 0],
      [pageNode("Mira"), 3],
      [pageNode("Oslo"), 1],
    ],
  );
  assert.deepEqual(projected.edges, [
    { from: pageNode("Mira"), to: pageNode("Oslo"), kinds: ["link", "ref"], count: 3 },
    { from: pageNode("Book"), to: pageNode("Oslo"), kinds: ["tag"], count: 1 },
  ]);
});

test("project: leaving refs out leaves a page with only refs an island", async () => {
  const view = memory();
  await addBlock(view, "A", "see ((b1))", undefined, "a1");
  await addBlock(view, "B", "said", undefined, "b1");
  const linkMap = getLinkMap(view.state);
  assert.deepEqual(project(linkMap, new Set(), new Set(["link", "tag"])).edges, []);
  assert.deepEqual(project(linkMap, new Set()).edges, [
    { from: pageNode("A"), to: pageNode("B"), kinds: ["ref"], count: 1 },
  ]);
});

test("project: an open bubble shows its blocks, lifted to the nearest one that shows", async () => {
  const linkMap = getLinkMap((await sample()).state);
  const projected = project(linkMap, new Set([pageNode("Mira"), pageNode("Oslo")]));
  assert.deepEqual(
    projected.nodes.map(({ id, parent, open }) => [id, parent, open]),
    [
      [pageNode("Book"), undefined, false],
      [pageNode("Mira"), undefined, true],
      [blockNode("m1"), pageNode("Mira"), false],
      [blockNode("m3"), pageNode("Mira"), false],
      [pageNode("Oslo"), undefined, true],
      [blockNode("o1"), pageNode("Oslo"), false],
    ],
  );
  assert.deepEqual(projected.edges, [
    { from: blockNode("m1"), to: pageNode("Oslo"), kinds: ["link"], count: 1 },
    // m2 is under m1, which is closed.
    { from: blockNode("m1"), to: blockNode("o1"), kinds: ["ref"], count: 1 },
    { from: blockNode("m3"), to: pageNode("Oslo"), kinds: ["link"], count: 1 },
    { from: pageNode("Book"), to: pageNode("Oslo"), kinds: ["tag"], count: 1 },
  ]);
  const deeper = project(linkMap, new Set([pageNode("Mira"), blockNode("m1")]));
  assert.ok(deeper.edges.some((e) => e.from === blockNode("m2") && e.to === pageNode("Oslo")));
});

test("project: an arrow inside one closed bubble is gone", async () => {
  const view = memory();
  await addBlock(view, "A", "top", undefined, "a1");
  await addBlock(view, "A", "see ((a1))", "a1", "a2");
  const linkMap = getLinkMap(view.state);
  assert.deepEqual(project(linkMap, new Set()).edges, []);
  assert.deepEqual(project(linkMap, new Set([pageNode("A")])).edges, [
    { from: blockNode("a2"), to: blockNode("a1"), kinds: ["ref"], count: 1 },
  ]);
});

test("getPreviewsOf: a block's first paragraph, null for none", async () => {
  const { state } = await sample();
  assert.deepEqual(getPreviewsOf(state, ["o1", "nope"]), [
    ["o1", "the city"],
    ["nope", null],
  ]);
});
