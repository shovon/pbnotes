/**
 * Run with: npm test
 *
 * `page.renamed` (#108, #89): what it reads, what it does to the graph, how
 * it meets writes on either side of it in fold order, and how it is undone.
 * What it does to one block's text is `relink.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliasAdded,
  aliasRemoved,
  blockCreated,
  blockEdited,
  getAliases,
  getPage,
  getProperties,
  getReferences,
  getTags,
  graphFold,
  holds,
  invert,
  NAMESPACE,
  propertySet,
  remember,
  searchNames,
  searchPages,
  tagAdded,
} from "../../graph.ts";
import type { Batched, Graph, Block } from "../../graph.ts";
import { PAGE_RENAMED, pageRenamed } from "./renamed.ts";

/** `events` folded onto `state`. */
const fold = (state: Graph, ...events: Batched[]): Graph => events.reduce(graphFold.reduce, state);

/** The ids on a page, depth first. */
const ids = (blocks: Block[]): string[] => blocks.flatMap((it) => [it.id, ...ids(it.children)]);

/** The text of the block `id`, wherever it is. */
const textOf = (state: Graph, page: string, id: string): string | undefined => {
  const walk = (blocks: Block[]): string | undefined => {
    for (const it of blocks) {
      if (it.id === id) return it.text;
      const under = walk(it.children);
      if (under !== undefined) return under;
    }
    return undefined;
  };
  return walk(getPage(state, page).blocks);
};

/**
 * `Bridal Falls`: `a` with a child `b`, a property, a tag and an alias. `Trip`
 * links to it three ways and mentions it in code; `Plans` tags it and
 * `Notes` has it as a property key.
 */
const BEFORE = fold(
  graphFold.initial,
  blockCreated("Bridal Falls", "A", undefined, "a"),
  blockCreated("Bridal Falls", "B", undefined, "b", "a"),
  propertySet("Bridal Falls", "Height", "60 m"),
  tagAdded("Bridal Falls", "Hikes"),
  aliasAdded("Bridal Falls", "BF"),
  blockCreated("Trip", "see [[Bridal Falls]], #[[bridal falls]] and [the falls]([[Bridal Falls]]) but not `[[Bridal Falls]]`", undefined, "t"),
  tagAdded("Plans", "Bridal Falls"),
  propertySet("Notes", "Bridal Falls", "go in May"),
);

const RENAME = pageRenamed("Bridal Falls", "Lake Lindeman");
const AFTER = fold(BEFORE, RENAME);

test("a malformed rename is skipped whole", () => {
  for (const payload of [null, "x", {}, { from: "Bridal Falls" }, { from: 7, to: "y" }, { from: "Bridal Falls", to: "  " }]) {
    const event = { type: `${NAMESPACE}page.renamed`, v: 1, payload };
    assert.equal(graphFold.reduce(BEFORE, event), BEFORE, JSON.stringify(payload));
  }
});

test("pageRenamed writes the event's own type and v", () => {
  assert.deepEqual(pageRenamed("a", "b"), {
    v: PAGE_RENAMED.v,
    type: PAGE_RENAMED.type,
    payload: { from: "a", to: "b" },
  });
});

test("the page moves with everything on it, and everything pointing at it follows", () => {
  const page = getPage(AFTER, "Lake Lindeman");
  assert.equal(page.title, "Lake Lindeman");
  assert.deepEqual(ids(page.blocks), ["a", "b"]);
  assert.deepEqual(getProperties(AFTER, "Lake Lindeman"), [{ key: "Height", value: "60 m" }]);
  assert.deepEqual(getTags(AFTER, "Lake Lindeman"), ["Hikes"]);
  assert.equal(
    textOf(AFTER, "Trip", "t"),
    "see [[Lake Lindeman]], #[[Lake Lindeman]] and [the falls]([[Lake Lindeman]]) but not `[[Bridal Falls]]`",
  );
  assert.deepEqual(getTags(AFTER, "Plans"), ["Lake Lindeman"]);
  assert.deepEqual(getProperties(AFTER, "Notes"), [{ key: "Lake Lindeman", value: "go in May" }]);
});

test("the old name opens the renamed page, with the aliases it had, and search leaves it out", () => {
  assert.equal(getPage(AFTER, "bridal falls").title, "Lake Lindeman");
  assert.deepEqual(ids(getPage(AFTER, "Bridal Falls").blocks), ["a", "b"]);
  assert.deepEqual(getAliases(AFTER, "Lake Lindeman"), ["BF", "Bridal Falls"]);
  assert.deepEqual(searchPages(AFTER, "bridal"), []);
  assert.deepEqual(searchPages(AFTER, "BF"), ["BF"]);
});

test("a link that sorts after the rename keeps its text, and still counts as a reference", () => {
  const late = fold(AFTER, blockCreated("Diary", "back to [[Bridal Falls]]", undefined, "d"));
  assert.equal(textOf(late, "Diary", "d"), "back to [[Bridal Falls]]");
  assert.ok(getReferences(late, "Lake Lindeman").some((it) => it.title === "Diary"));
});

test("a write on the old name that sorts after the rename lands on the renamed page, until the alias goes", () => {
  const late = fold(
    AFTER,
    blockCreated("Bridal Falls", "late", undefined, "late"),
    tagAdded("Bridal Falls", "Waterfalls"),
  );
  assert.deepEqual(ids(getPage(late, "Lake Lindeman").blocks), ["a", "b", "late"]);
  assert.deepEqual(getTags(late, "Lake Lindeman"), ["Hikes", "Waterfalls"]);
  assert.equal(getPage(late, "Bridal Falls").title, "Lake Lindeman");

  const freed = fold(late, aliasRemoved("Lake Lindeman", "Bridal Falls"), blockCreated("Bridal Falls", "new", undefined, "new"));
  assert.deepEqual(ids(getPage(freed, "Bridal Falls").blocks), ["new"]);
  assert.equal(getPage(freed, "Bridal Falls").title, "Bridal Falls");
  assert.deepEqual(searchPages(freed, "bridal"), ["Bridal Falls"]);
});

test("an edit that sorts before the rename is kept, with its links rewritten", () => {
  const edited = fold(BEFORE, blockEdited("t", "now [[Bridal Falls]] and #[[Bridal Falls]] only"), RENAME);
  assert.equal(textOf(edited, "Trip", "t"), "now [[Lake Lindeman]] and #[[Lake Lindeman]] only");
});

test("a bare tag stays bare when the new name can be one, and takes brackets when not", () => {
  const state = fold(
    graphFold.initial,
    blockCreated("Falls", "x", undefined, "x"),
    blockCreated("Trip", "went #falls.", undefined, "t"),
  );
  assert.equal(textOf(fold(state, pageRenamed("Falls", "Lakes")), "Trip", "t"), "went #Lakes.");
  assert.equal(textOf(fold(state, pageRenamed("Falls", "Lake Lindeman")), "Trip", "t"), "went #[[Lake Lindeman]].");
});

test("two renames of one page: the first in fold order wins, and the other does nothing", () => {
  const toB = pageRenamed("Bridal Falls", "B");
  const toC = pageRenamed("Bridal Falls", "C");
  const one = fold(BEFORE, toB);
  const other = fold(BEFORE, toC);
  assert.equal(fold(one, toC), one);
  assert.equal(fold(other, toB), other);
  assert.deepEqual(ids(getPage(one, "B").blocks), ["a", "b"]);
  assert.deepEqual(ids(getPage(other, "C").blocks), ["a", "b"]);
});

test("a rename onto a page with content does nothing, and onto one only links name goes through", () => {
  const taken = fold(BEFORE, blockCreated("Lake Lindeman", "mine", undefined, "m"));
  assert.equal(fold(taken, RENAME), taken);
  const linked = fold(BEFORE, blockCreated("Diary", "[[Lake Lindeman]]", undefined, "d"));
  assert.deepEqual(ids(getPage(fold(linked, RENAME), "Lake Lindeman").blocks), ["a", "b"]);
});

test("A → B → C leaves both A and B as aliases of C; renaming back onto one drops it", () => {
  const state = fold(
    graphFold.initial,
    blockCreated("A", "x", undefined, "x"),
    pageRenamed("A", "B"),
    pageRenamed("B", "C"),
  );
  assert.deepEqual(getAliases(state, "C"), ["A", "B"]);
  assert.equal(getPage(state, "A").title, "C");
  assert.deepEqual(searchNames(state, "").map((it) => it.title), ["C"]);
  const back = fold(state, pageRenamed("C", "B"));
  assert.deepEqual(getAliases(back, "B"), ["A", "C"]);
  assert.equal(getPage(back, "A").title, "B");
});

test("a day renamed to a page leaves no alias, rewrites links by any of its names, and keeps later writes", () => {
  const state = fold(
    graphFold.initial,
    blockCreated("2026-11-06", "met Mira", undefined, "x"),
    blockCreated("Diary", "[[Nov 6th, 2026]] and [[2026-11-06]]", undefined, "d"),
    pageRenamed("2026-11-06", "Meeting"),
    blockCreated("2026-11-06", "later that day", undefined, "y"),
  );
  assert.deepEqual(ids(getPage(state, "Meeting").blocks), ["x"]);
  assert.deepEqual(getAliases(state, "Meeting"), []);
  assert.equal(textOf(state, "Diary", "d"), "[[Meeting]] and [[Meeting]]");
  assert.deepEqual(ids(getPage(state, "2026-11-06").blocks), ["y"]);
});

test("a day renamed while a page keys it by two of its names keeps the title key's value, whichever came first (#371)", () => {
  for (const [first, second] of [
    [propertySet("Diary", "2026-11-06", "by title"), propertySet("Diary", "Nov 6th, 2026", "by date")],
    [propertySet("Diary", "Nov 6th, 2026", "by date"), propertySet("Diary", "2026-11-06", "by title")],
  ]) {
    const state = fold(graphFold.initial, first, second, pageRenamed("2026-11-06", "Meeting"));
    assert.deepEqual(getProperties(state, "Diary"), [{ key: "Meeting", value: "by title" }]);
  }
});

test("a page renamed to a date name becomes that day", () => {
  const state = fold(graphFold.initial, blockCreated("Meeting", "x", undefined, "x"), pageRenamed("Meeting", "Nov 6th, 2026"));
  assert.deepEqual(ids(getPage(state, "2026-11-06").blocks), ["x"]);
  assert.equal(getPage(state, "Meeting").title, "2026-11-06");
});

test("a case-only rename changes how the page shows, and nothing else (#89)", () => {
  const state = fold(
    graphFold.initial,
    blockCreated("mira", "x", undefined, "x"),
    blockCreated("Diary", "met [[mira]]", undefined, "d"),
  );
  const after = fold(state, pageRenamed("mira", "Mira"));
  assert.equal(getPage(after, "mira").title, "Mira");
  assert.equal(textOf(after, "Diary", "d"), "met [[mira]]");
  assert.deepEqual(searchPages(after, "mi"), ["Mira"]);
  assert.deepEqual(getAliases(after, "Mira"), []);
  assert.equal(fold(after, pageRenamed("Mira", "Mira")), after);
});

test("a rename is undone by renaming back: the page, its links, and the old name free again", () => {
  const inverse = invert(BEFORE, [RENAME])!;
  const undone = fold(AFTER, ...inverse);
  const page = getPage(undone, "Bridal Falls");
  assert.equal(page.title, "Bridal Falls");
  assert.deepEqual(ids(page.blocks), ["a", "b"]);
  // Each link names the page as it is spelled, not as that link once spelled it.
  assert.equal(
    textOf(undone, "Trip", "t"),
    "see [[Bridal Falls]], #[[Bridal Falls]] and [the falls]([[Bridal Falls]]) but not `[[Bridal Falls]]`",
  );
  assert.deepEqual(getAliases(undone, "Bridal Falls"), ["BF"]);
  assert.equal(getPage(undone, "Lake Lindeman").title, "Lake Lindeman");
  assert.deepEqual(getPage(undone, "Lake Lindeman").blocks, []);
});

test("a case-only rename is undone back to the old spelling", () => {
  const state = fold(graphFold.initial, blockCreated("mira", "x", undefined, "x"));
  const rename = pageRenamed("mira", "Mira");
  const undone = fold(fold(state, rename), ...invert(state, [rename])!);
  assert.equal(getPage(undone, "Mira").title, "mira");
});

test("a rename that does nothing has nothing to undo", () => {
  assert.deepEqual(invert(BEFORE, [pageRenamed("Nowhere", "Elsewhere")]), []);
});

test("undo stops once the renamed page has changed since", () => {
  const step = remember(BEFORE, [RENAME]);
  assert.equal(holds(AFTER, step), true);
  assert.equal(holds(fold(AFTER, blockEdited("a", "changed")), step), false);
  assert.equal(holds(fold(AFTER, blockCreated("Bridal Falls", "late", undefined, "late")), step), false);
  assert.equal(holds(fold(AFTER, aliasRemoved("Lake Lindeman", "Bridal Falls")), step), false);
});

// ── A page with nothing on it, only links to it ─────────────────────────────

/** `Bridal Falls` is written nowhere: other pages link to it, tag it and key a property by it. */
const LINKED_ONLY = fold(
  graphFold.initial,
  blockCreated("Trip", "saw [[Bridal Falls]], #[[bridal falls]] and [the falls]([[Bridal Falls]])", undefined, "t"),
  tagAdded("Hikes", "Bridal Falls"),
  propertySet("Hikes", "Bridal Falls", "June"),
);

test("a page with nothing on it is renamed: every link, tag and key to it follows", () => {
  const state = fold(LINKED_ONLY, pageRenamed("Bridal Falls", "Waterfall"));
  assert.equal(textOf(state, "Trip", "t"), "saw [[Waterfall]], #[[Waterfall]] and [the falls]([[Waterfall]])");
  assert.deepEqual(getTags(state, "Hikes"), ["Waterfall"]);
  assert.deepEqual(getProperties(state, "Hikes"), [{ key: "Waterfall", value: "June" }]);
  assert.equal(getPage(state, "Bridal Falls").title, "Waterfall");
  assert.deepEqual(getReferences(state, "Waterfall").map((it) => it.title), ["Trip"]);
});

test("a link to the old title that sorts after it still opens the renamed page, and a write there lands on it", () => {
  const state = fold(
    LINKED_ONLY,
    pageRenamed("Bridal Falls", "Waterfall"),
    blockCreated("Diary", "back at [[Bridal Falls]]", undefined, "d"),
    blockCreated("Bridal Falls", "first note", undefined, "f"),
  );
  assert.equal(textOf(state, "Diary", "d"), "back at [[Bridal Falls]]");
  assert.deepEqual(ids(getPage(state, "Waterfall").blocks), ["f"]);
  assert.equal(getPage(state, "Bridal Falls").title, "Waterfall");
});

test("two renames of a page with nothing on it: the first in fold order wins, and the other does nothing", () => {
  const toB = pageRenamed("Bridal Falls", "B");
  const toC = pageRenamed("Bridal Falls", "C");
  const one = fold(LINKED_ONLY, toB);
  const other = fold(LINKED_ONLY, toC);
  assert.equal(fold(one, toC), one);
  assert.equal(fold(other, toB), other);
  assert.equal(textOf(one, "Trip", "t")?.includes("[[B]]"), true);
  assert.equal(textOf(other, "Trip", "t")?.includes("[[C]]"), true);
});

test("a name another page claims as an alias is not renamed out from under it", () => {
  const state = fold(
    graphFold.initial,
    blockCreated("JavaScript", "x", undefined, "x"),
    aliasAdded("JavaScript", "JS"),
    blockCreated("Notes", "[[JS]]", undefined, "n"),
  );
  assert.equal(fold(state, pageRenamed("JS", "Script")), state);
});

test("renaming a page with nothing on it is undone by renaming back, leaving nothing behind", () => {
  const events = [pageRenamed("Bridal Falls", "Waterfall")];
  const after = fold(LINKED_ONLY, ...events);
  const inverse = invert(LINKED_ONLY, events)!;
  const undone = fold(after, ...inverse);
  assert.equal(textOf(undone, "Trip", "t"), "saw [[Bridal Falls]], #[[Bridal Falls]] and [the falls]([[Bridal Falls]])");
  assert.deepEqual(getAliases(undone, "Bridal Falls"), []);
  assert.deepEqual(getAliases(undone, "Waterfall"), []);
  assert.equal(getPage(undone, "Bridal Falls").title, "Bridal Falls");
  assert.ok(holds(after, remember(LINKED_ONLY, events)));
});
