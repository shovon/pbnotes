/**
 * Run with: npm test
 *
 * What a name opens (#221), through the queries the app calls: aliases and
 * built-in date names, and the order between them and a page of its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addBlock,
  aliasAdded,
  aliasRemoved,
  blockDeleted,
  getAliasOf,
  getAliases,
  getPage,
  getProperties,
  getReferences,
  getTaggedBy,
  getTags,
  graphFold,
  listPages,
  propertySet,
  resolve,
  searchNames,
  searchPages,
  tagAdded,
} from "../graph.ts";
import type { Graph, GraphView } from "../graph.ts";

type Event = { type: string; v: number; payload: unknown };

/** A view over the fold alone, written through the app's own commands. */
function memory(): GraphView & { add(events: Event[]): void } {
  let state: Graph = graphFold.initial;
  return {
    get state() {
      return state;
    },
    async dispatch(v, type, payload) {
      state = graphFold.reduce(state, { type, v, payload });
    },
    add(events) {
      state = events.reduce(graphFold.reduce, state);
    },
  };
}

/** The pages listed under a page's references, by title. */
const referencing = (state: Graph, title: string) => getReferences(state, title).map((page) => page.title);

/** The text of each block that references a page. */
const linkingText = (state: Graph, title: string) =>
  getReferences(state, title).flatMap((page) => page.blocks.map((block) => block.text));

test("an alias opens its page, and the page's references hold links by either name", async () => {
  const view = memory();
  await addBlock(view, "JavaScript", "a language", undefined, "j");
  await addBlock(view, "Notes", "learn [[JS]]", undefined, "a");
  await addBlock(view, "Notes", "and #JS", "a", "b");
  await addBlock(view, "Notes", "and [[JavaScript]]", "b", "c");
  view.add([aliasAdded("JavaScript", "JS")]);

  const page = getPage(view.state, "js");
  assert.equal(page.title, "JavaScript");
  assert.deepEqual(page.blocks.map((block) => block.id), ["j"]);
  assert.deepEqual(linkingText(view.state, "JavaScript"), ["learn [[JS]]", "and #JS", "and [[JavaScript]]"]);
  assert.deepEqual(linkingText(view.state, "JS"), linkingText(view.state, "JavaScript"));
  assert.equal(resolve(view.state, "JS"), "JavaScript");
  assert.equal(getAliasOf(view.state, "js"), "JavaScript");

  view.add([aliasRemoved("JavaScript", "JS")]);
  assert.equal(getPage(view.state, "JS").title, "JS");
  assert.deepEqual(linkingText(view.state, "JavaScript"), ["and [[JavaScript]]"]);
  assert.equal(getAliasOf(view.state, "JS"), undefined);
});

test("a day answers to its date names with nothing written about them", async () => {
  const view = memory();
  await addBlock(view, "2024-11-04", "election day", undefined, "d");
  await addBlock(view, "Notes", "see [[Nov 4th, 2024]]", undefined, "a");
  await addBlock(view, "Notes", "and [[november 4th, 2024]]", "a", "b");
  await addBlock(view, "Notes", "and [[2024-11-04]]", "b", "c");

  assert.equal(getPage(view.state, "Nov 4th, 2024").title, "2024-11-04");
  assert.deepEqual(getPage(view.state, "November 4th, 2024").blocks.map((block) => block.id), ["d"]);
  assert.deepEqual(linkingText(view.state, "2024-11-04"), [
    "see [[Nov 4th, 2024]]",
    "and [[november 4th, 2024]]",
    "and [[2024-11-04]]",
  ]);
  assert.equal(getAliasOf(view.state, "Nov 4th, 2024"), undefined);
  assert.deepEqual(getAliases(view.state, "2024-11-04"), []);
});

test("a day nothing is on still opens by its date name", () => {
  const state = graphFold.initial;
  assert.equal(resolve(state, "Nov 4th, 2024"), "2024-11-04");
  assert.equal(getPage(state, "nov 4th, 2024").title, "2024-11-04");
  assert.equal(resolve(state, "Feb 30th, 2024"), "Feb 30th, 2024");
});

test("no alias takes over a date, in either form; a day can have aliases of its own", async () => {
  const view = memory();
  await addBlock(view, "Foo", "foo", undefined, "f");
  view.add([aliasAdded("Foo", "Nov 4th, 2024"), aliasAdded("Foo", "2024-11-04")]);
  assert.equal(resolve(view.state, "Nov 4th, 2024"), "2024-11-04");
  assert.equal(resolve(view.state, "2024-11-04"), "2024-11-04");
  assert.deepEqual(getAliases(view.state, "Foo"), []);

  view.add([aliasAdded("2024-11-04", "Election day")]);
  assert.equal(resolve(view.state, "election day"), "2024-11-04");
  assert.deepEqual(getAliases(view.state, "Nov 4th, 2024"), ["Election day"]);
});

test("a name with a page of its own is never redirected, and is once that page empties", async () => {
  const view = memory();
  view.add([aliasAdded("JavaScript", "JS")]);
  await addBlock(view, "JS", "its own note", undefined, "own");
  await addBlock(view, "Nov 4th, 2024", "a page, not the day", undefined, "date");

  assert.equal(getPage(view.state, "JS").title, "JS");
  assert.deepEqual(getAliases(view.state, "JavaScript"), []);
  assert.equal(getPage(view.state, "Nov 4th, 2024").title, "Nov 4th, 2024");

  view.add([blockDeleted("own"), blockDeleted("date")]);
  assert.equal(getPage(view.state, "JS").title, "JavaScript");
  assert.equal(getPage(view.state, "Nov 4th, 2024").title, "2024-11-04");
});

test("properties and tags of its own keep a name its own page too", () => {
  const view = memory();
  view.add([aliasAdded("JavaScript", "JS"), propertySet("JS", "Kind", "acronym")]);
  assert.equal(resolve(view.state, "JS"), "JS");
  view.add([aliasAdded("Python", "Py"), tagAdded("Py", "Short")]);
  assert.equal(resolve(view.state, "Py"), "Py");
});

test("two pages claiming one alias resolve to the one that sorts first, in either order", () => {
  const a = aliasAdded("Zebra", "Z");
  const b = aliasAdded("Apple", "Z");
  for (const events of [[a, b], [b, a]]) {
    const state = events.reduce(graphFold.reduce, graphFold.initial);
    assert.equal(resolve(state, "Z"), "Apple");
    assert.deepEqual(getAliases(state, "Apple"), ["Z"]);
    assert.deepEqual(getAliases(state, "Zebra"), []);
  }
});

test("a chain resolves one hop and never loops", () => {
  const state = [aliasAdded("A", "B"), aliasAdded("B", "C"), aliasAdded("C", "A")].reduce(
    graphFold.reduce,
    graphFold.initial,
  );
  // Each of A, B and C has an alias of its own, so each is its own page.
  for (const name of ["A", "B", "C"]) assert.equal(resolve(state, name), name);

  const one = [aliasAdded("A", "B"), aliasAdded("C", "A")].reduce(graphFold.reduce, graphFold.initial);
  assert.equal(resolve(one, "B"), "A");
  assert.equal(resolve(one, "A"), "A");
});

test("an alias on itself changes nothing", () => {
  const state = graphFold.reduce(graphFold.initial, aliasAdded("A", "a"));
  assert.equal(resolve(state, "A"), "A");
  assert.deepEqual(getAliases(state, "A"), []);
});

test("an alias claimed by a date name opens the day", () => {
  const state = graphFold.reduce(graphFold.initial, aliasAdded("Nov 4th, 2024", "Election"));
  assert.equal(resolve(state, "Election"), "2024-11-04");
});

test("a name nothing names opens itself, spelled as asked", () => {
  assert.equal(resolve(graphFold.initial, "Brand New"), "Brand New");
  assert.equal(getPage(graphFold.initial, "Brand New").title, "Brand New");
});

test("tags and properties are read off the page a name opens", () => {
  const view = memory();
  view.add([
    aliasAdded("JavaScript", "JS"),
    tagAdded("JavaScript", "Language"),
    propertySet("JavaScript", "Typed", "no"),
    tagAdded("Notes", "JS"),
    tagAdded("Docs", "JavaScript"),
    tagAdded("Docs", "JS"),
  ]);
  assert.deepEqual(getTags(view.state, "JS"), ["Language"]);
  assert.deepEqual(getProperties(view.state, "js"), [{ key: "Typed", value: "no" }]);
  assert.deepEqual(getTaggedBy(view.state, "JavaScript"), ["Docs", "Notes"]);
});

test("a page is not a reference to itself by any of its names", async () => {
  const view = memory();
  await addBlock(view, "JavaScript", "short for [[JS]]", undefined, "j");
  view.add([aliasAdded("JavaScript", "JS")]);
  assert.deepEqual(referencing(view.state, "JavaScript"), []);
});

test("search offers a day's date names for each day it offers, and says what each opens", async () => {
  const view = memory();
  await addBlock(view, "2024-11-04", "written", undefined, "d");
  view.add([aliasAdded("JavaScript", "JS")]);

  assert.deepEqual(searchPages(view.state, "nov 4"), ["Nov 4th, 2024"]);
  assert.deepEqual(searchNames(view.state, "4th, 2024"), [
    { title: "Nov 4th, 2024", opens: "2024-11-04" },
    { title: "November 4th, 2024", opens: "2024-11-04" },
  ]);
  assert.deepEqual(searchPages(view.state, "nov 5"), []);
  assert.deepEqual(searchNames(view.state, "js"), [{ title: "JS", opens: "JavaScript" }]);
  assert.deepEqual(searchNames(view.state, "javascript"), [
    { title: "JavaScript", opens: "JavaScript" },
  ]);
});

test("search keeps a date name's spelling once a link has written it", async () => {
  const view = memory();
  await addBlock(view, "Notes", "[[nov 4th, 2024]]", undefined, "a");
  assert.deepEqual(searchPages(view.state, "4th"), ["nov 4th, 2024", "November 4th, 2024"]);
  assert.deepEqual(searchPages(view.state, "2024-11"), ["2024-11-04"]);
});

test("All pages lists a page once, under its title, with every name's links and tags", async () => {
  const view = memory();
  await addBlock(view, "Notes", "[[JS]] and [[JavaScript]]", undefined, "a");
  await addBlock(view, "Notes", "[[Nov 4th, 2024]]", "a", "b");
  await addBlock(view, "Diary", "[[November 4th, 2024]]", undefined, "c");
  view.add([aliasAdded("JavaScript", "JS"), tagAdded("Docs", "JS"), tagAdded("Docs", "JavaScript")]);

  const rows = new Map(listPages(view.state).map((row) => [row.title, row]));
  assert.deepEqual([...rows.keys()].sort(), ["2024-11-04", "Diary", "Docs", "JavaScript", "Notes"]);
  assert.equal(rows.get("JavaScript")?.references, 1);
  assert.equal(rows.get("JavaScript")?.taggedBy, 1);
  assert.equal(rows.get("2024-11-04")?.references, 2);
  assert.equal(rows.get("2024-11-04")?.blocks, 0);
});
