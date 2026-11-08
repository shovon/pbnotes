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
  deleteBlocks,
  editBlock,
  getPage,
  getPages,
  HANDLES,
  inCode,
  UNDO,
  listPages,
  indentBlock,
  indentBlocks,
  moveBlock,
  moveBlocks,
  NAMESPACE,
  outdentBlock,
  outdentBlocks,
  pageDeleted,
  pageRenamed,
  graphFold,
  propertyRemoved,
  addTag,
  aliasAdded,
  aliasRemoved,
  iconRemoved,
  iconSet,
  tagAdded,
  tagRemoved,
  propertySet,
  searchNames,
  searchPages,
  setProperty,
  today,
} from "./graph.ts";
import type { Graph, GraphView, Place } from "./graph.ts";

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

test("deleteBlocks deletes several blocks as one batch, each held one once, and one alone as itself", async () => {
  // Today: a, b(c), and Elsewhere: e
  const start = async () => {
    const view = await outline();
    await addBlock(view, "Elsewhere", "E", undefined, "e");
    return view;
  };
  const view = await start();
  const written = view.events.length;
  // `c` sits under `b`, and goes with it; `gone` is passed over; `a` twice is once.
  await deleteBlocks(view, ["c", "a", "b", "gone", "a", "e"]);
  assert.equal(view.events.length, written + 1, "one record");
  assert.deepEqual(view.events.at(-1), batch([blockDeleted("a"), blockDeleted("b"), blockDeleted("e")]));
  assert.deepEqual(getPage(view.state, TODAY).blocks, []);
  assert.deepEqual(getPage(view.state, "Elsewhere").blocks, []);

  const one = await start();
  await deleteBlocks(one, ["c", "b"]);
  assert.deepEqual(one.events.at(-1), blockDeleted("b"), "one block left is its own event, not a batch");

  const none = await start();
  const before = none.events.length;
  await assert.rejects(deleteBlocks(none, ["gone"]), Error);
  await assert.rejects(deleteBlocks(none, []), Error);
  assert.equal(none.events.length, before, "nothing written");
});

test("indentBlocks files each block under the sibling above, in turn, all or nothing (#259)", async () => {
  /** Today: a b c d; Elsewhere: e f. */
  const start = async () => {
    const view = memory();
    for (const [id, after] of [["a"], ["b", "a"], ["c", "b"], ["d", "c"]]) await addBlock(view, TODAY, id, after, id);
    await addBlock(view, "Elsewhere", "e", undefined, "e");
    await addBlock(view, "Elsewhere", "f", "e", "f");
    return view;
  };
  const shape = (blocks: { id: string; children: unknown[] }[]): string =>
    blocks.map((it) => (it.children.length ? `${it.id}(${shape(it.children as never)})` : it.id)).join(" ");
  const pages = (view: GraphView) => [shape(getPage(view.state, TODAY).blocks), shape(getPage(view.state, "Elsewhere").blocks)];
  const cases: [string, string[], string[]][] = [
    ["siblings together go under the same block, in their order", ["b", "c"], ["a(b c) d", "e f"]],
    ["a gap: each under its own sibling above", ["b", "d"], ["a(b) c(d)", "e f"]],
    ["across pages", ["c", "f"], ["a b(c) d", "e(f)"]],
  ];
  for (const [name, ids, expected] of cases) {
    const view = await start();
    const written = view.events.length;
    await indentBlocks(view, ids);
    assert.equal(view.events.length, written + 1, `${name}: one record`);
    assert.equal((view.events.at(-1) as { type: string }).type, `${NAMESPACE}batch`, name);
    assert.deepEqual(pages(view), expected, name);
  }
  const one = await start();
  await indentBlocks(one, ["c"]);
  assert.deepEqual(one.events.at(-1), blockIndented({ id: "c", parent: "b" }), "one block is its own event");
  for (const ids of [["a", "b"], ["b", "e"], ["e"]]) {
    const view = await start();
    const written = view.events.length;
    await indentBlocks(view, ids);
    assert.equal(view.events.length, written, `${ids}: one first among its siblings, so nothing moves`);
  }
  await assert.rejects(indentBlocks(await start(), ["gone"]), Error);
});

test("outdentBlocks brings each block out a level, in turn, all or nothing (#260)", async () => {
  /** Today: a(b c d) e(f); Elsewhere: g(h). */
  const start = async () => {
    const view = memory();
    await addBlock(view, TODAY, "a", undefined, "a");
    await addBlock(view, TODAY, "b", undefined, "b", "a");
    await addBlock(view, TODAY, "c", "b", "c", "a");
    await addBlock(view, TODAY, "d", "c", "d", "a");
    await addBlock(view, TODAY, "e", "a", "e");
    await addBlock(view, TODAY, "f", undefined, "f", "e");
    await addBlock(view, "Elsewhere", "g", undefined, "g");
    await addBlock(view, "Elsewhere", "h", undefined, "h", "g");
    return view;
  };
  const shape = (blocks: { id: string; children: unknown[] }[]): string =>
    blocks.map((it) => (it.children.length ? `${it.id}(${shape(it.children as never)})` : it.id)).join(" ");
  const pages = (view: GraphView) => [shape(getPage(view.state, TODAY).blocks), shape(getPage(view.state, "Elsewhere").blocks)];
  const cases: [string, string[], string[]][] = [
    ["selected siblings come out in order, and one below goes under the last", ["b", "c"], ["a b c(d) e(f)", "g(h)"]],
    ["a gap", ["b", "f"], ["a b(c d) e f", "g(h)"]],
    ["across pages", ["d", "h"], ["a(b c) d e(f)", "g h"]],
  ];
  for (const [name, ids, expected] of cases) {
    const view = await start();
    const written = view.events.length;
    await outdentBlocks(view, ids);
    assert.equal(view.events.length, written + 1, `${name}: one record`);
    assert.equal((view.events.at(-1) as { type: string }).type, `${NAMESPACE}batch`, name);
    assert.deepEqual(pages(view), expected, name);
  }
  const one = await start();
  await outdentBlocks(one, ["d"]);
  assert.deepEqual(one.events.at(-1), blockOutdented({ id: "d", after: "a" }), "one block is its own event");
  for (const ids of [["b", "e"], ["f", "g"], ["a"]]) {
    const view = await start();
    const written = view.events.length;
    await outdentBlocks(view, ids);
    assert.equal(view.events.length, written, `${ids}: one already top-level, so nothing moves`);
  }
  await assert.rejects(outdentBlocks(await start(), ["gone"]), Error);
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

test("moveBlocks lands the top-most blocks together, in order, as one record (#269)", async () => {
  /** Today: a(a1) b c d; Elsewhere: e f. */
  const start = async () => {
    const view = memory();
    await addBlock(view, TODAY, "a", undefined, "a");
    await addBlock(view, TODAY, "a1", undefined, "a1", "a");
    for (const [id, after] of [["b", "a"], ["c", "b"], ["d", "c"]]) await addBlock(view, TODAY, id, after, id);
    await addBlock(view, "Elsewhere", "e", undefined, "e");
    await addBlock(view, "Elsewhere", "f", "e", "f");
    return view;
  };
  const shape = (blocks: { id: string; children: unknown[] }[]): string =>
    blocks.map((it) => (it.children.length ? `${it.id}(${shape(it.children as never)})` : it.id)).join(" ");
  const pages = (view: GraphView) => [shape(getPage(view.state, TODAY).blocks), shape(getPage(view.state, "Elsewhere").blocks)];
  const cases: [string, string[], string, Place, string[]][] = [
    ["siblings, lower on the page", ["a", "b"], TODAY, { after: "d" }, ["c d a(a1) b", "e f"]],
    ["a gap closes", ["a", "c"], TODAY, { after: "d" }, ["b d a(a1) c", "e f"]],
    ["under a block: the rest follow at its depth", ["b", "c"], TODAY, { parent: "d" }, ["a(a1) d(b c)", "e f"]],
    ["after a child: the rest follow at that depth", ["c", "d"], TODAY, { after: "a1", parent: "a" }, ["a(a1 c d) b", "e f"]],
    ["from two pages onto a third", ["b", "f"], "Fresh", { first: true }, ["a(a1) c d", "e"]],
    ["a parent and its child: only the parent moves, child and all", ["a", "a1"], "Elsewhere", { after: "f" }, ["b c d", "e f a(a1)"]],
  ];
  for (const [name, ids, title, place, expected] of cases) {
    const view = await start();
    const written = view.events.length;
    await moveBlocks(view, ids, title, place);
    assert.equal(view.events.length, written + 1, `${name}: one record`);
    assert.deepEqual(pages(view), expected, name);
  }
  const fresh = await start();
  await moveBlocks(fresh, ["b", "f"], "Fresh", { first: true });
  assert.equal(shape(getPage(fresh.state, "Fresh").blocks), "b f", "the third page");

  const one = await start();
  await moveBlocks(one, ["c"], TODAY, { after: "d" });
  assert.deepEqual(one.events.at(-1), blockMoved({ id: "c", page: TODAY, after: "d" }), "one block is its own event");

  const there = await start();
  const before = there.events.length;
  await moveBlocks(there, ["b", "c"], TODAY, { after: "a" });
  assert.equal(there.events.length, before, "already where they would go: nothing written");

  const gone = await start();
  await moveBlocks(gone, ["gone", "b"], TODAY, { after: "d" });
  assert.deepEqual(pages(gone), ["a(a1) c d b", "e f"], "a block the graph lacks is passed over, as other writers' deletes are");

  const refused: [string, string[], string, Place][] = [
    ["into one of their subtrees", ["b", "a"], TODAY, { parent: "a1" }],
    ["after one of them", ["b", "c"], TODAY, { after: "c" }],
    ["only blocks the graph lacks", ["gone"], TODAY, {}],
    ["none at all", [], TODAY, {}],
    ["after a block the page lacks", ["b"], TODAY, { after: "e" }],
  ];
  for (const [name, ids, title, place] of refused) {
    const view = await start();
    const written = view.events.length;
    await assert.rejects(moveBlocks(view, ids, title, place), Error, name);
    assert.equal(view.events.length, written, name);
  }
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
    iconSet("x", "y"),
    iconRemoved("x"),
    pageDeleted("x"),
    pageRenamed("x", "y"),
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

test("listPages and searchNames carry the icon of the page each opens (#329)", () => {
  const state = [
    blockCreated("Mira", "about [[Oslo]]", undefined, "m"),
    iconSet("Mira", "🌲"),
    aliasAdded("Mira", "M"),
  ].reduce(graphFold.reduce, graphFold.initial);
  assert.deepEqual(
    listPages(state).map(({ title, icon }) => [title, icon]),
    [["Mira", "🌲"], ["Oslo", undefined]],
  );
  assert.deepEqual(searchNames(state, "m"), [
    { title: "M", opens: "Mira", icon: "🌲" },
    { title: "Mira", opens: "Mira", icon: "🌲" },
  ]);
  assert.deepEqual(searchNames(state, "oslo"), [{ title: "Oslo", opens: "Oslo" }], "no icon, no field");
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
      v("icon.set", 1),
      v("icon.removed", 1),
      v("page.deleted", 1),
      v("page.renamed", 1),
      v("batch", 1),
    ]),
  );
});
