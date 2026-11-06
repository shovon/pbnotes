/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockCreated, pageDeleted, graphFold, propertySet, tagAdded } from "@pbnotes/graph";
import type { Graph } from "@pbnotes/graph";
import { DAYS, getView } from "./place-view.ts";

const TODAY = "2026-09-21";
const TOMORROW = "2026-09-22";

/** The fold over `events`, as a ledger would hold it, at version 7. */
function folded(...events: { type: string; v: number; payload: unknown }[]) {
  const state: Graph = events.reduce(graphFold.reduce, graphFold.initial);
  return { state, version: 7 };
}

test("the view is labelled with the version it was read at", () => {
  assert.equal(getView(folded(), undefined, TODAY).version, 7);
});

test("the view is the journal with today on top, or the one page asked for", () => {
  const view = folded(blockCreated(TODAY, "saw [[Mira]]", undefined, "b1"));

  // Tomorrow has nothing on it yet, and is still where the user will type.
  const journal = getView(view, undefined, TOMORROW);
  assert.deepEqual(
    journal.showing.map((shown) => shown.page.title),
    [TOMORROW, TODAY],
  );

  const page = getView(view, { page: "Mira" }, TOMORROW);
  assert.equal(page.showing.length, 1);
  assert.deepEqual(
    page.showing[0].references.map((cut) => [cut.title, cut.blocks[0].text]),
    [[TODAY, "saw [[Mira]]"]],
  );

  // Zoomed, what links to the page is not shown.
  const zoomed = getView(view, { page: "Mira", block: "b1" }, TOMORROW);
  assert.deepEqual(zoomed.showing[0].references, []);
});

test("a day dated after today keeps its place above it", () => {
  const view = folded(blockCreated(TOMORROW, "from a fast clock", undefined, "b1"));
  assert.deepEqual(
    getView(view, undefined, TODAY).showing.map((shown) => shown.page.title),
    [TOMORROW, TODAY],
  );
});

test("every page in the view carries its properties, whether or not it has blocks", () => {
  const view = folded(
    blockCreated(TODAY, "saw [[Mira]]", undefined, "b1"),
    propertySet(TODAY, "Weather", "rain"),
    propertySet("Mira", "Role", "editor"),
  );

  const journal = getView(view, undefined, TOMORROW);
  assert.deepEqual(
    journal.showing.map((shown) => [shown.page.title, shown.properties]),
    [
      [TOMORROW, []],
      [TODAY, [{ key: "Weather", value: "rain" }]],
    ],
  );

  // A page with properties and no blocks.
  const mira = getView(view, { page: "Mira" }, TOMORROW);
  assert.deepEqual(mira.showing[0].properties, [{ key: "Role", value: "editor" }]);

  // Under a zoom too: drawing them or not is the window's call.
  const zoomed = getView(view, { page: TODAY, block: "b1" }, TOMORROW);
  assert.deepEqual(zoomed.showing[0].properties, [{ key: "Weather", value: "rain" }]);
});

test("every page in the view carries how many times it has been deleted", () => {
  const view = folded(
    blockCreated("Mira", "one", undefined, "b1"),
    pageDeleted("Mira"),
    blockCreated("Mira", "two", undefined, "b2"),
    pageDeleted("mira"),
    blockCreated(TODAY, "today", undefined, "b3"),
  );
  assert.equal(getView(view, { page: "Mira" }, TODAY).showing[0].deletions, 2);
  assert.equal(getView(view, { page: "Mira", block: "b2" }, TODAY).showing[0].deletions, 2);
  assert.deepEqual(
    getView(view, undefined, TODAY).showing.map((shown) => shown.deletions),
    [0],
  );
});

test("every page in the view carries its tags and what tags it, except under a zoom", () => {
  const view = folded(
    blockCreated(TODAY, "a day", undefined, "b1"),
    tagAdded(TODAY, "Work"),
    tagAdded("Mira", TODAY),
    tagAdded("Mira", "Work"),
    tagAdded("Atlas", "Mira"),
  );

  const journal = getView(view, undefined, TOMORROW);
  assert.deepEqual(
    journal.showing.map((shown) => [shown.page.title, shown.tags, shown.taggedBy]),
    [
      [TOMORROW, [], []],
      [TODAY, ["Work"], ["Mira"]],
    ],
  );

  // A page with tags and no blocks.
  const mira = getView(view, { page: "Mira" }, TOMORROW);
  assert.deepEqual(mira.showing[0].tags, [TODAY, "Work"]);
  assert.deepEqual(mira.showing[0].taggedBy, ["Atlas"]);

  // A page only tags name.
  const work = getView(view, { page: "work" }, TOMORROW);
  assert.deepEqual(work.showing[0].tags, []);
  assert.deepEqual(work.showing[0].taggedBy, [TODAY, "Mira"]);

  // Under a zoom, neither: the zoom shows a block, not the page.
  const zoomed = getView(view, { page: TODAY, block: "b1" }, TOMORROW);
  assert.deepEqual(zoomed.showing[0].tags, []);
  assert.deepEqual(zoomed.showing[0].taggedBy, []);
});

/** A day `n` days before `TODAY`, as the journal names it. */
const before = (n: number) => new Date(Date.UTC(2026, 8, 21 - n)).toISOString().slice(0, 10);

/** One block on each of the `count` days before today, the block on day `n` named `d<n>`. */
const daysBack = (count: number) =>
  Array.from({ length: count }, (_, i) => blockCreated(before(i + 1), `day ${i + 1}`, undefined, `d${i + 1}`));

const titles = (view: { showing: { page: { title: string } }[] }) => view.showing.map((it) => it.page.title);

test("the journal shows the newest days and today, and says where older days start (#282)", () => {
  const view = folded(...daysBack(DAYS + 5));
  const journal = getView(view, undefined, TODAY);
  assert.deepEqual(titles(journal), [TODAY, ...Array.from({ length: DAYS }, (_, i) => before(i + 1))]);
  assert.deepEqual(journal.journal, { from: before(DAYS), next: before(DAYS + 5) });
});

test("asked from a day, the journal shows every day on or after it, and the next from reads DAYS more (#282)", () => {
  const view = folded(...daysBack(3 * DAYS));
  const journal = getView(view, undefined, TODAY, before(DAYS + 2));
  assert.equal(journal.showing.length, 1 + DAYS + 2, "today, and every day back to from");
  assert.deepEqual(journal.journal, { from: before(DAYS + 2), next: before(2 * DAYS + 2) });

  // A from between days: the days on or after it, and nothing more.
  const between = folded(blockCreated(before(1), "one", undefined, "a"), blockCreated(before(5), "five", undefined, "b"));
  const gap = getView(between, undefined, TODAY, before(3));
  assert.deepEqual(titles(gap), [TODAY, before(1)]);
  assert.deepEqual(gap.journal, { from: before(3), next: before(5) });
});

test("a day arriving above the window is added, and none falls off the bottom (#282)", () => {
  const events = daysBack(DAYS);
  const first = getView(folded(...events), undefined, TODAY);
  const from = first.journal?.from;
  const later = getView(folded(...events, blockCreated(TOMORROW, "a fast clock", undefined, "t")), undefined, TODAY, from);
  assert.deepEqual(titles(later), [TOMORROW, ...titles(first)]);
  assert.equal(later.journal?.from, from);
});

test("the window always reaches today, and with nothing older says so (#282)", () => {
  assert.deepEqual(getView(folded(), undefined, TODAY).journal, { from: TODAY, next: null });
  // A from after today, from a window whose clock moved back.
  const view = folded(blockCreated(TODAY, "today", undefined, "a"), blockCreated(before(1), "yesterday", undefined, "b"));
  const ahead = getView(view, undefined, TODAY, TOMORROW);
  assert.deepEqual(titles(ahead), [TODAY]);
  assert.deepEqual(ahead.journal, { from: TODAY, next: before(1) });
});

test("only days in the window are read, for what links to them as for the rest (#282)", () => {
  const view = folded(
    ...daysBack(DAYS + 1),
    blockCreated("Mira", `about [[${before(DAYS + 1)}]]`, undefined, "m"),
  );
  const journal = getView(view, undefined, TODAY);
  assert.equal(titles(journal).includes(before(DAYS + 1)), false);
  const older = getView(view, undefined, TODAY, journal.journal?.next ?? undefined);
  const last = older.showing.at(-1);
  assert.equal(last?.page.title, before(DAYS + 1));
  assert.deepEqual(last?.references.map((cut) => cut.title), ["Mira"]);
});

test("previews are for the refs the view shows, its linked references included (#282)", () => {
  const view = folded(
    blockCreated(TODAY, "see ((x)) on [[Mira]]", undefined, "a"),
    blockCreated("Mira", "the quoted", undefined, "x"),
    blockCreated("Atlas", "about ((y)) and [[Mira]]", undefined, "b"),
    blockCreated("Atlas", "never on show", undefined, "y"),
    blockCreated("Atlas", "((z))", undefined, "c"),
    blockCreated("Atlas", "nor this", undefined, "z"),
  );
  assert.deepEqual(getView(view, undefined, TODAY).previews, [["x", "the quoted"]]);
  // Mira's view shows what links to it: today's block and Atlas's.
  assert.deepEqual(getView(view, { page: "Mira" }, TODAY).previews, [
    ["x", "the quoted"],
    ["y", "never on show"],
  ]);
});

test("a page's view carries no journal window (#282)", () => {
  assert.equal(getView(folded(), { page: "Mira" }, TODAY).journal, undefined);
});
