/**
 * Run with: npm test
 *
 * Each case plans a small graph and folds what it plans with the app's own
 * fold, so what is checked is what a user would see.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAliases, getPage, getProperties, getReferences, getTags, graphFold } from "@pbnotes/graph";
import type { Block, Graph } from "@pbnotes/graph";
import { nameOf } from "@pbnotes/files";
import { DEFAULTS } from "../config/config.ts";
import type { Config } from "../config/config.ts";
import { plan } from "./plan.ts";
import type { Finding } from "../report.ts";

const ID = "6437a1b2-0000-4000-8000-000000000001";

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function run(files: Record<string, string>, config: Config = DEFAULTS, assets = new Map<string, Uint8Array>()) {
  const planned = plan({ files: Object.entries(files).map(([path, text]) => ({ path, text })), assets }, config, ids());
  const state = planned.events.reduce(
    (s: Graph, e) => graphFold.reduce(s, { ...e, at: "2026-11-05T00:00:00.000Z" }),
    graphFold.initial,
  );
  return { ...planned, state };
}

type Shape = string | [string, Shape[]];
const shape = (blocks: Block[]): Shape[] =>
  blocks.map((b) => (b.children.length ? [b.text, shape(b.children)] : b.text));

const kinds = (findings: Finding[], kind: Finding["kind"]) => findings.filter((f) => f.kind === kind);

test("a journal file is its day, and its tree comes out as written", () => {
  const { state, report } = run({ "journals/2024_01_31.md": "- a\n\t- b\n\t- c\n\t\t- d\n- e" });
  assert.deepEqual(shape(getPage(state, "2024-01-31").blocks), [["a", ["b", ["c", ["d"]]]], "e"]);
  assert.equal(report.counts.journals, 1);
  assert.equal(report.counts.blocks, 5);
});

test("a page's title: title:: beats the filename", () => {
  const { state } = run({ "pages/some-file.md": "title:: The Real Title\n\n- x" });
  assert.deepEqual(shape(getPage(state, "The Real Title").blocks), ["x"]);
  assert.deepEqual(getProperties(state, "The Real Title"), []);
});

test("a page's title from its filename, under each name format", () => {
  const lowbar = run({ "pages/A___B%3F.md": "- x" }, { ...DEFAULTS, fileNames: "triple-lowbar" });
  assert.deepEqual(shape(getPage(lowbar.state, "A/B?").blocks), ["x"]);
  const legacy = run({ "pages/A.B.md": "- x", "pages/C%2FD.md": "- y" });
  assert.deepEqual(shape(getPage(legacy.state, "A/B").blocks), ["x"]);
  assert.deepEqual(shape(getPage(legacy.state, "C/D").blocks), ["y"]);
});

test("journal names under a custom file format, and one that doesn't parse", () => {
  const { state, report } = run(
    { "journals/2024-01-31.md": "- day", "journals/scratch.md": "- loose" },
    { ...DEFAULTS, journalFiles: "yyyy-MM-dd" },
  );
  assert.deepEqual(shape(getPage(state, "2024-01-31").blocks), ["day"]);
  assert.deepEqual(shape(getPage(state, "scratch").blocks), ["loose"]);
  assert.deepEqual(kinds(report.findings, "journal-name-unparsed"), [
    { kind: "journal-name-unparsed", path: "journals/scratch.md", title: "scratch" },
  ]);
});

test("two files, one page: the second's blocks after the first's, both reported", () => {
  const { state, report } = run({ "pages/Foo.md": "- one\n\t- under", "pages/foo.md": "- two" });
  assert.deepEqual(shape(getPage(state, "foo").blocks), [["one", ["under"]], "two"]);
  assert.deepEqual(kinds(report.findings, "merged"), [{ kind: "merged", title: "Foo", paths: ["pages/Foo.md", "pages/foo.md"] }]);
  assert.equal(report.counts.pages, 1);
});

test("page properties: tags:: and alias:: become tags and aliases, the rest property.set", () => {
  const { state, report } = run({
    "pages/Book.md": "tags:: #[[Self Development]] #[[Social Skills]]\nalias:: [[The Book]], Bk\ntype:: book\n\n- x",
  });
  assert.deepEqual(getTags(state, "Book"), ["Self Development", "Social Skills"]);
  assert.deepEqual(getAliases(state, "Book"), ["Bk", "The Book"]);
  assert.deepEqual(getProperties(state, "Book").map((p) => [p.key, p.value]), [["type", "book"]]);
  assert.deepEqual(getPage(state, "The Book").title, "Book");
  assert.deepEqual([report.counts.tags, report.counts.aliases, report.counts.properties], [2, 2, 1]);
});

test("tags:: as A, B, and a blank item reported", () => {
  const { state, report } = run({ "pages/P.md": "tags:: A, , [[B]], #C\n\n- x" });
  assert.deepEqual(getTags(state, "P"), ["A", "B", "C"]);
  assert.deepEqual(kinds(report.findings, "blank-list-item"), [{ kind: "blank-list-item", path: "pages/P.md", key: "tags" }]);
});

test("a ((uuid)) to an id:: block resolves after the fold", () => {
  const { state } = run({
    "pages/Target.md": `- the target\n  id:: ${ID}`,
    "pages/Source.md": `- see ((${ID}))`,
  });
  const [target] = getPage(state, "Target").blocks;
  assert.equal(target.id, ID);
  assert.equal(target.text, "the target");
  assert.deepEqual(getPage(state, "Source").blocks[0].text, `see ((${ID}))`);
});

test("a duplicate id:: is kept by the first file; the second block gets a fresh id", () => {
  const { state, report } = run({
    "pages/A.md": `- first\n  id:: ${ID}`,
    "pages/B.md": `- second\n  id:: ${ID}`,
  });
  assert.equal(getPage(state, "A").blocks[0].id, ID);
  assert.notEqual(getPage(state, "B").blocks[0].id, ID);
  assert.equal(getPage(state, "B").blocks[0].text, "second");
  assert.deepEqual(kinds(report.findings, "duplicate-id"), [{ kind: "duplicate-id", path: "pages/B.md", id: ID, first: "pages/A.md" }]);
});

test("a dangling ref stays as written and is reported", () => {
  const missing = "6437a1b2-0000-4000-8000-0000000000ff";
  const { state, report } = run({ "pages/A.md": `- see ((${missing}))` });
  assert.equal(getPage(state, "A").blocks[0].text, `see ((${missing}))`);
  assert.deepEqual(kinds(report.findings, "dangling-ref"), [{ kind: "dangling-ref", path: "pages/A.md", id: missing }]);
});

test("a PNG is stored and relinked, its size attribute gone; a PDF and a missing file are left", () => {
  const png = new TextEncoder().encode("png bytes");
  const pdf = new TextEncoder().encode("pdf bytes");
  const assets = new Map([["assets/shot.png", png], ["assets/doc.pdf", pdf]]);
  const text = "- ![shot](../assets/shot.png){:height 1079, :width 778}\n- [doc](../assets/doc.pdf)\n- ![gone](../assets/gone.png)";
  const { state, images, report } = run({ "pages/A.md": text }, DEFAULTS, assets);
  const name = nameOf(png, "png");
  assert.deepEqual(shape(getPage(state, "A").blocks), [
    `![shot](images/${name})`,
    "[doc](../assets/doc.pdf)",
    "![gone](../assets/gone.png)",
  ]);
  assert.deepEqual(images, [{ name, extension: "png", bytes: png }]);
  assert.deepEqual(
    kinds(report.findings, "asset-left").map((f) => f.kind === "asset-left" && [f.target, f.why]),
    [["../assets/doc.pdf", "not-an-image"], ["../assets/gone.png", "missing"]],
  );
  assert.equal(report.counts.images, 1);
});

test("default title format: no aliases written, and date links open their days", () => {
  const { state, events } = run({
    "journals/2024_11_04.md": "- the day",
    "pages/Notes.md": "- on [[Nov 4th, 2024]] and [[April 15th, 2020]]",
  });
  assert.equal(events.filter((e) => e.type.endsWith("alias.added")).length, 0);
  assert.equal(getPage(state, "Nov 4th, 2024").title, "2024-11-04");
  assert.deepEqual(shape(getPage(state, "Nov 4th, 2024").blocks), ["the day"]);
  assert.equal(getPage(state, "April 15th, 2020").title, "2020-04-15");
  assert.deepEqual(getReferences(state, "2024-11-04").map((p) => p.title), ["Notes"]);
});

test("custom title format: a journal file's day gets its name in it", () => {
  const config = { ...DEFAULTS, journalTitles: "EEE do, MMM yyyy" };
  const { state } = run({ "journals/2024_11_04.md": "- the day" }, config);
  assert.deepEqual(getAliases(state, "2024-11-04"), ["Mon 4th, Nov 2024"]);
  assert.equal(getPage(state, "Mon 4th, Nov 2024").title, "2024-11-04");
});

test("custom title format: links in it name days, with or without a file, each name once", () => {
  const config = { ...DEFAULTS, journalTitles: "EEE do, MMM yyyy" };
  const { state, events } = run(
    {
      "journals/2024_11_04.md": "- the day",
      "pages/Notes.md": "- [[mon 4th, nov 2024]] [[Mon 4th, Nov 2024]] #[[Wed 15th, Apr 2020]] [[Wed 15th, Apr 2020]] [[Fri 15th, Apr 2020]]",
    },
    config,
  );
  // Spellings that differ only in case are one name, as they are to pbnotes: written once.
  assert.deepEqual(getAliases(state, "2024-11-04"), ["Mon 4th, Nov 2024"]);
  assert.deepEqual(getAliases(state, "2020-04-15"), ["Wed 15th, Apr 2020"]);
  assert.equal(events.filter((e) => e.type.endsWith("alias.added")).length, 2);
  assert.equal(getPage(state, "Wed 15th, Apr 2020").title, "2020-04-15");
  // The wrong weekday names no real day: it stays a page.
  assert.equal(getPage(state, "Fri 15th, Apr 2020").title, "Fri 15th, Apr 2020");
  // The aliases come after the day's blocks.
  const types = events.map((e) => e.type.split("#")[1]);
  assert.ok(types.indexOf("alias.added") > types.indexOf("block.created"));
});

test("a page file named like a date stays a page and is reported", () => {
  const { state, report } = run({ "journals/2024_11_04.md": "- day", "pages/Nov 4th, 2024.md": "- page" });
  assert.deepEqual(shape(getPage(state, "2024-11-04").blocks), ["day"]);
  assert.deepEqual(kinds(report.findings, "page-named-like-a-day"), [
    { kind: "page-named-like-a-day", path: "pages/Nov 4th, 2024.md", title: "Nov 4th, 2024", day: "2024-11-04" },
  ]);
});

test("empty files and dropped logbooks are reported", () => {
  const { report, events } = run({
    "journals/2024_01_01.md": "-\n",
    "journals/2024_01_02.md": "",
    "pages/A.md": "- DONE x\n  :LOGBOOK:\n  CLOCK: a\n  :END:",
  });
  assert.equal(events.length, 1);
  assert.deepEqual(kinds(report.findings, "empty").map((f) => f.kind === "empty" && f.path), [
    "journals/2024_01_01.md",
    "journals/2024_01_02.md",
  ]);
  assert.deepEqual(kinds(report.findings, "logbooks-dropped"), [{ kind: "logbooks-dropped", path: "pages/A.md", count: 1 }]);
});
