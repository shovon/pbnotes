/**
 * Run with: npm test
 *
 * The gate and the commands with no log around them: a `GraphView` that is
 * nothing but an array, which is all a third party has to supply.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import {
  addBlock,
  batch,
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockMoved,
  blockOutdented,
  deleteBlock,
  editBlock,
  getPages,
  HANDLES,
  inCode,
  UNDO,
  listPages,
  indentBlock,
  moveBlock,
  NAMESPACE,
  outdentBlock,
  pageDeleted,
  graphFold,
  propertyRemoved,
  addTag,
  aliasAdded,
  aliasRemoved,
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

test("blockCreated writes first only when it is true, and addBlock puts that block at the top", async () => {
  assert.equal("first" in blockCreated(TODAY, "x", undefined, "x").payload, false);
  assert.equal("first" in blockCreated(TODAY, "x", undefined, "x", undefined, false).payload, false);
  const view = await outline();
  const page = await addBlock(view, TODAY, "top", undefined, "t", undefined, true);
  assert.deepEqual(view.events.at(-1), blockCreated(TODAY, "top", undefined, "t", undefined, true));
  assert.deepEqual(page.blocks.map((it) => it.id), ["t", "a", "b"]);
});

test("addBlock refuses first with an after or a parent, and writes nothing", async () => {
  const view = await outline();
  const before = view.events.length;
  await assert.rejects(addBlock(view, TODAY, "D", "a", "d", undefined, true), /first block/);
  await assert.rejects(addBlock(view, TODAY, "D", undefined, "d", "b", true), /first block/);
  assert.equal(view.events.length, before);
});

test("addBlock refuses a parent the page lacks, and an after that is not its child", async () => {
  const view = await outline();
  await assert.rejects(addBlock(view, TODAY, "D", undefined, "d", "gone"), /No such block/);
  await assert.rejects(addBlock(view, TODAY, "D", "a", "d", "b"), /not a child/);
  await assert.rejects(addBlock(view, "Elsewhere", "D", undefined, "d", "a"), /No such block/);
  assert.equal(view.events.length, 4, "nothing written");
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
    ["add under", (view) => addBlock(view, TODAY, "D", undefined, "d", "a"), blockCreated(TODAY, "D", undefined, "d", "a")],
    ["add under, after", (view) => addBlock(view, TODAY, "D", "c", "d", "b"), blockCreated(TODAY, "D", "c", "d", "b")],
    ["edit", (view) => editBlock(view, "c", "C again"), blockEdited("c", "C again")],
    ["delete", (view) => deleteBlock(view, "b"), blockDeleted("b")],
    ["indent", (view) => indentBlock(view, "b"), blockIndented({ id: "b", parent: "a" })],
    ["outdent", (view) => outdentBlock(view, "c"), blockOutdented({ id: "c", after: "b" })],
    ["move", (view) => moveBlock(view, "b", "Elsewhere", { first: true }), blockMoved({ id: "b", page: "Elsewhere", first: true })],
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

test("moveBlock refuses what the fold would ignore, and writes nothing for a block already there", async () => {
  // a, b(c)
  const refused: [string, (view: GraphView) => Promise<unknown>][] = [
    ["a block the graph lacks", (view) => moveBlock(view, "gone", TODAY)],
    ["under itself", (view) => moveBlock(view, "b", TODAY, { parent: "b" })],
    ["under its own child", (view) => moveBlock(view, "b", TODAY, { parent: "c" })],
    ["after a block the page lacks", (view) => moveBlock(view, "a", TODAY, { after: "gone" })],
    ["after a block on another page", (view) => moveBlock(view, "c", "Elsewhere", { after: "a" })],
    ["after one not the parent's child", (view) => moveBlock(view, "a", TODAY, { after: "b", parent: "b" })],
    ["first with a parent", (view) => moveBlock(view, "c", TODAY, { parent: "a", first: true })],
  ];
  for (const [name, run] of refused) {
    const view = await outline();
    const written = view.events.length;
    await assert.rejects(run(view), Error, name);
    assert.equal(view.events.length, written, name);
  }
  const view = await outline();
  const written = view.events.length;
  const page = await moveBlock(view, "c", TODAY, { parent: "b" });
  assert.equal(view.events.length, written, "already there");
  assert.equal(page.title, TODAY);
});

test("every builder writes the v its own gate reads, and there is one for every event", () => {
  const built = [
    blockCreated(TODAY, "x", undefined, "x"),
    blockEdited("x", "y"),
    blockDeleted("x"),
    blockIndented({ id: "x", parent: "y" }),
    blockOutdented({ id: "x", after: "y" }),
    blockMoved({ id: "x", page: "y" }),
    propertySet("x", "y", "z"),
    propertyRemoved("x", "y"),
    tagAdded("x", "y"),
    tagRemoved("x", "y"),
    aliasAdded("x", "y"),
    aliasRemoved("x", "y"),
    pageDeleted("x"),
    batch([pageDeleted("x")]),
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
  await addTag(view, "Book", "Oslo");
  await addTag(view, "Mira", "oslo");
  assert.deepEqual(listPages(view.state), [
    { title: TODAY, blocks: 2, references: 0, taggedBy: 0 },
    { title: "author", blocks: 0, references: 0, taggedBy: 0 },
    { title: "Book", blocks: 0, references: 0, taggedBy: 0 },
    { title: "Mira", blocks: 2, references: 1, taggedBy: 0 },
    // Tagged twice, linked twice: the two are counted apart.
    { title: "Oslo", blocks: 0, references: 2, taggedBy: 2 },
  ]);
});

test("listPages carries when a page last changed, when it ever did", () => {
  const at = "2026-11-01T10:00:00.000Z";
  const state = graphFold.reduce(graphFold.initial, { ...blockCreated("Mira", "[[Oslo]]", undefined, "m"), at });
  assert.deepEqual(listPages(state), [
    { title: "Mira", blocks: 1, references: 0, taggedBy: 0, edited: Date.parse(at) },
    { title: "Oslo", blocks: 0, references: 1, taggedBy: 0 },
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

/**
 * Every event module: `events/<subject>/<event>/<event>.ts`, found on disk
 * so a new one is covered without being listed here.
 */
function eventModules(): string[] {
  const events = new URL("events/", import.meta.url);
  const folders = (at: URL) =>
    readdirSync(at, { withFileTypes: true })
      .filter((it) => it.isDirectory())
      .map((it) => it.name);
  return folders(events)
    .flatMap((subject) =>
      folders(new URL(`${subject}/`, events)).map((event) => `events/${subject}/${event}/${event}.ts`),
    )
    .filter((path) => existsSync(new URL(path, import.meta.url)))
    .sort();
}

/**
 * Events that undo each other import each other, which is safe only while no
 * event module builds an event as it loads (#238). Each module is imported
 * first in a fresh process, so none is loaded already, and the graph that
 * results has to be the same every time.
 */
test("every event module loads first to the same HANDLES and UNDO", () => {
  const src = new URL(".", import.meta.url);
  const tables = (first: string) =>
    execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(new URL(first, src).href)});
       const { HANDLES, UNDO } = await import(${JSON.stringify(new URL("graph.ts", src).href)});
       console.log(JSON.stringify([HANDLES, Object.keys(UNDO).sort()]));`,
    ]).toString();
  const modules = eventModules();
  assert.ok(modules.length >= 12, `found ${modules.join(", ")}`);
  const expected = JSON.stringify([HANDLES, Object.keys(UNDO).sort()]) + "\n";
  for (const module of modules) assert.equal(tables(module), expected, module);
});

/**
 * Every event type and the `v` this build reads and writes, written out. A
 * name and a `v` never get a new meaning (README), and an event's `v` now
 * lives in its own module, so nothing else would notice one changing: the
 * builders read it from the same place.
 */
test("the event names and their v are exactly these", () => {
  const v = (name: string, at: number) => [`${NAMESPACE}${name}`, at] as const;
  assert.deepEqual(
    HANDLES,
    Object.fromEntries([
      v("block.created", 1),
      v("block.edited", 2),
      v("block.deleted", 2),
      v("block.indented", 2),
      v("block.outdented", 2),
      v("block.moved", 1),
      v("property.set", 1),
      v("property.removed", 1),
      v("tag.added", 1),
      v("tag.removed", 1),
      v("alias.added", 1),
      v("alias.removed", 1),
      v("page.deleted", 1),
      v("batch", 1),
    ]),
  );
});
