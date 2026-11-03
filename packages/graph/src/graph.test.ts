/**
 * Run with: npm test
 *
 * The gate and the commands with no log around them: a `GraphView` that is
 * nothing but an array, which is all a third party has to supply.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addBlock,
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockOutdented,
  deleteBlock,
  editBlock,
  getPages,
  HANDLES,
  inCode,
  listPages,
  indentBlock,
  NAMESPACE,
  outdentBlock,
  pageDeleted,
  graphFold,
  propertyRemoved,
  tagAdded,
  tagRemoved,
  propertySet,
  searchPages,
  setProperty,
  today,
} from "./graph.ts";
import type { Graph, GraphView } from "./graph.ts";

const TODAY = "2026-09-21";

/** A view over a plain list of events, folded through the gate. */
function memory(): GraphView & { events: unknown[] } {
  const events: { type: string; v: number; payload: unknown }[] = [];
  let state: Graph = graphFold.initial;
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

test("the fold leaves the graph alone for what this build cannot read", () => {
  const state = graphFold.initial;
  const created = { page: TODAY, id: crypto.randomUUID(), text: "x" };
  for (const event of [
    { type: `${NAMESPACE}block.created`, v: 2, payload: created },
    { type: "block.created", v: 1, payload: created },
    { type: `${NAMESPACE}block.renamed`, v: 1, payload: created },
    { type: "__proto__", v: 1, payload: created },
  ]) {
    assert.equal(graphFold.reduce(state, event), state, event.type);
  }
  assert.notEqual(
    graphFold.reduce(state, {
      type: `${NAMESPACE}block.created`,
      v: 1,
      payload: created,
    }),
    state,
  );
});

test("a writer with its own log gets the app's checks and the app's fold", async () => {
  const view = memory();
  const page = await addBlock(view, TODAY, "hello", undefined, "h");
  await editBlock(view, page.blocks[0].id, "hello #Mira");
  await assert.rejects(editBlock(view, "nope", "x"));
  assert.equal(view.events.length, 2);
  assert.deepEqual(getPages(view.state)[0].blocks[0].text, "hello #Mira");
});

test("blockCreated is the event addBlock writes, with or without an after", async () => {
  const view = memory();
  await addBlock(view, TODAY, "first", undefined, "a");
  await addBlock(view, TODAY, "second", "a", "b");
  assert.deepEqual(view.events, [
    blockCreated(TODAY, "first", undefined, "a"),
    blockCreated(TODAY, "second", "a", "b"),
  ]);
});

/**
 * `a` and `b` at the top of today, and `c` filed under `b`: something for
 * every command to do, written through the commands themselves.
 */
async function outline(): Promise<ReturnType<typeof memory>> {
  const view = memory();
  await addBlock(view, TODAY, "A", undefined, "a");
  await addBlock(view, TODAY, "B", "a", "b");
  await addBlock(view, TODAY, "C", "b", "c");
  await indentBlock(view, "c");
  return view;
}

test("each builder is the event its command writes, and folds to the same graph", async () => {
  const cases: [string, (view: GraphView) => Promise<unknown>, { type: string; v: number; payload: unknown }][] = [
    ["add", (view) => addBlock(view, TODAY, "D", "a", "d"), blockCreated(TODAY, "D", "a", "d")],
    ["edit", (view) => editBlock(view, "c", "C again"), blockEdited("c", "C again")],
    ["delete", (view) => deleteBlock(view, "b"), blockDeleted("b")],
    ["indent", (view) => indentBlock(view, "b"), blockIndented({ id: "b", parent: "a" })],
    ["outdent", (view) => outdentBlock(view, "c"), blockOutdented({ id: "c", after: "b" })],
  ];
  for (const [name, run, built] of cases) {
    const view = await outline();
    const before = view.state;
    await run(view);
    assert.deepEqual(view.events.at(-1), built, name);
    assert.notEqual(view.state, before, name);
    assert.deepEqual(graphFold.reduce(before, built), view.state, name);
  }
});

test("every builder writes the v its own gate reads, and there is one for every event", () => {
  const built = [
    blockCreated(TODAY, "x", undefined, "x"),
    blockEdited("x", "y"),
    blockDeleted("x"),
    blockIndented({ id: "x", parent: "y" }),
    blockOutdented({ id: "x", after: "y" }),
    propertySet("x", "y", "z"),
    propertyRemoved("x", "y"),
    tagAdded("x", "y"),
    tagRemoved("x", "y"),
    pageDeleted("x"),
  ];
  for (const event of built) assert.equal(event.v, HANDLES[event.type], event.type);
  assert.deepEqual(
    built.map((event) => event.type).sort(),
    Object.keys(HANDLES).sort(),
  );
});

test("searchPages finds titles written on and titles only linked, prefix matches first", async () => {
  const view = memory();
  await addBlock(view, "Foo Page", "see [[the food plan]] and #seafood", undefined, "f");
  await addBlock(view, TODAY, "[[FOOTNOTES]]", undefined, "n");
  assert.deepEqual(searchPages(view.state, " foo"), [
    "Foo Page",
    "FOOTNOTES",
    "seafood",
    "the food plan",
  ]);
  assert.deepEqual(searchPages(view.state, "", 2), [TODAY, "Foo Page"]);
  assert.deepEqual(searchPages(view.state, "nothing"), []);
});

test("listPages lists every page once, journal days and pages only named included, with their counts", async () => {
  const view = memory();
  await addBlock(view, "Mira", "about [[Oslo]] and [[mira]]", undefined, "m1");
  await addBlock(view, "Mira", "plain", undefined, "m2");
  await indentBlock(view, "m2");
  await addBlock(view, TODAY, "met [[MIRA]] in [[Oslo]]", undefined, "d1");
  await addBlock(view, TODAY, "more on [[Mira]]", "d1", "d2");
  await indentBlock(view, "d2");
  await setProperty(view, "Book", "author", "Mira");
  assert.deepEqual(listPages(view.state), [
    { title: TODAY, blocks: 2, references: 0 },
    { title: "author", blocks: 0, references: 0 },
    { title: "Book", blocks: 0, references: 0 },
    { title: "Mira", blocks: 2, references: 1 },
    { title: "Oslo", blocks: 0, references: 2 },
  ]);
});

test("listPages carries when a page last changed, when it ever did", () => {
  const at = "2026-11-01T10:00:00.000Z";
  const state = graphFold.reduce(graphFold.initial, { ...blockCreated("Mira", "[[Oslo]]", undefined, "m"), at });
  assert.deepEqual(listPages(state), [
    { title: "Mira", blocks: 1, references: 0, edited: Date.parse(at) },
    { title: "Oslo", blocks: 0, references: 1 },
  ]);
});

test("inCode is true in code spans, fences of either kind and math, and nowhere else", () => {
  const text = "a [[x]] `[[y` b\n\n~~~\n[[z\n~~~\n\n$[[m]]$ [[w\n\n```\n[[open";
  const at = (needle: string) => text.indexOf(needle) - 2;
  assert.equal(inCode(text, at("x]]")), false);
  assert.equal(inCode(text, at("y")), true);
  assert.equal(inCode(text, at("z")), true);
  assert.equal(inCode(text, at("m]]")), true);
  assert.equal(inCode(text, at("w")), false);
  assert.equal(inCode(text, at("open")), true);
});

test("today is the local calendar day of the moment it is handed", () => {
  // Built from local parts, so this holds in any time zone.
  assert.equal(today(new Date(2026, 9, 27, 23, 59)), "2026-10-27");
  assert.equal(today(new Date(2026, 0, 5, 0, 0)), "2026-01-05");
});
