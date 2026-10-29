/**
 * Run with: npm test
 *
 * The gate and the commands with no log around them: a `PagesView` that is
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
  indentBlock,
  NAMESPACE,
  outdentBlock,
  pagesFold,
  searchPages,
  today,
} from "./pages.ts";
import type { Pages, PagesView } from "./pages.ts";

const TODAY = "2026-09-21";

/** A view over a plain list of events, folded through the gate. */
function memory(): PagesView & { events: unknown[] } {
  const events: { type: string; v: number; payload: unknown }[] = [];
  let state: Pages = pagesFold.initial;
  return {
    events,
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      const event = { type, v, payload };
      events.push(event);
      state = pagesFold.reduce(state, event);
    },
  };
}

test("the fold leaves the pages alone for what this build cannot read", () => {
  const state = pagesFold.initial;
  const created = { page: TODAY, id: crypto.randomUUID(), text: "x" };
  for (const event of [
    { type: `${NAMESPACE}block.created`, v: 2, payload: created },
    { type: "block.created", v: 1, payload: created },
    { type: `${NAMESPACE}block.renamed`, v: 1, payload: created },
    { type: "__proto__", v: 1, payload: created },
  ]) {
    assert.equal(pagesFold.reduce(state, event), state, event.type);
  }
  assert.notEqual(
    pagesFold.reduce(state, {
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

test("each builder is the event its command writes, and folds to the same pages", async () => {
  const cases: [string, (view: PagesView) => Promise<unknown>, { type: string; v: number; payload: unknown }][] = [
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
    assert.deepEqual(pagesFold.reduce(before, built), view.state, name);
  }
});

test("every builder writes the v its own gate reads, and there is one for every block event", () => {
  const built = [
    blockCreated(TODAY, "x", undefined, "x"),
    blockEdited("x", "y"),
    blockDeleted("x"),
    blockIndented({ id: "x", parent: "y" }),
    blockOutdented({ id: "x", after: "y" }),
  ];
  for (const event of built) assert.equal(event.v, HANDLES[event.type], event.type);
  // Block events only: the property events' builders are #133.
  assert.deepEqual(
    built.map((event) => event.type).sort(),
    Object.keys(HANDLES).filter((type) => type.startsWith(`${NAMESPACE}block.`)).sort(),
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
