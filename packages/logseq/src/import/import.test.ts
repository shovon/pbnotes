/**
 * Run with: npm test
 *
 * `importGraph` twice over: on a folder in memory, for what it reads and
 * passes over, and end to end, on the fixture graph in this package into a
 * real ledger, folded with the app's fold.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openOrCreate, openWriter } from "@pbnotes/ledger";
import { getAliases, getPage, getProperties, getReferences, getTags, graphFold } from "@pbnotes/graph";
import type { Block, Graph } from "@pbnotes/graph";
import { nameOf } from "@pbnotes/files";
import { diskFolder, storeBeside } from "./disk.ts";
import { importGraph } from "./import.ts";
import type { Folder } from "./import.ts";
import type { Finding } from "../report.ts";

const FIXTURE = path.join(import.meta.dirname, "..", "..", "fixture", "graph");
const ID = "6437a1b2-0000-4000-8000-000000000001";

/** A folder in memory: each key a file's path, its value the file's text or bytes. */
function memoryFolder(files: Record<string, string | Uint8Array>): Folder {
  const list = async (dir: string) => {
    const prefix = dir === "" ? "" : `${dir}/`;
    const seen = new Map<string, boolean>();
    for (const file of Object.keys(files)) {
      if (!file.startsWith(prefix)) continue;
      const [name, ...rest] = file.slice(prefix.length).split("/");
      seen.set(name, rest.length > 0);
    }
    return seen.size ? [...seen].map(([name, folder]) => ({ name, folder })) : undefined;
  };
  return {
    list,
    text: async (p) => (typeof files[p] === "string" ? files[p] : undefined),
    bytes: async (p) => {
      const it = files[p];
      return it === undefined ? undefined : typeof it === "string" ? new TextEncoder().encode(it) : it;
    },
  };
}

type Shape = string | [string, Shape[]];
const shape = (blocks: Block[]): Shape[] =>
  blocks.map((b) => (b.children.length ? [b.text, shape(b.children)] : b.text));

test("in memory: images stored before any event, events posted in order, the rest reported", async () => {
  const png = new TextEncoder().encode("png");
  const calls: string[] = [];
  const posted: { type: string; payload: unknown }[] = [];
  let n = 0;
  const report = await importGraph(
    memoryFolder({
      "journals/2024_01_31.md": "- a\n\t- ![x](../assets/x.png)",
      "pages/Org.org": "* x",
      "pages/notes.txt": "x",
      "pages/sub/Inner.md": "- x",
      "whiteboards/w.edn": "{}",
      ".git/HEAD": "ref",
      "README.md": "hello",
      "assets/x.png": png,
    }),
    {
      post: async (_v, type, payload) => {
        calls.push("post");
        posted.push({ type, payload });
      },
    },
    {
      newId: () => `id-${++n}`,
      store: async (bytes, extension) => {
        calls.push(`store ${extension}`);
        assert.deepEqual(bytes, png);
      },
    },
  );
  assert.deepEqual(calls, ["store png", "post", "post"]);
  assert.deepEqual(
    posted.map((e) => e.payload),
    [
      { page: "2024-01-31", id: "id-1", text: "a" },
      { page: "2024-01-31", id: "id-2", text: `![x](images/${nameOf(png, "png")})`, parent: "id-1" },
    ],
  );
  const skipped = report.findings.filter((f) => f.kind === "skipped");
  assert.deepEqual(new Set(skipped), new Set<Finding>([
    { kind: "skipped", path: "pages/Org.org", why: "org" },
    { kind: "skipped", path: "pages/notes.txt", why: "not-markdown" },
    { kind: "skipped", path: "pages/sub/", why: "folder" },
    { kind: "skipped", path: "whiteboards/", why: "not-pages" },
    { kind: "skipped", path: "README.md", why: "not-pages" },
  ]));
  assert.ok(report.findings.some((f) => f.kind === "config-missing"));
});

test("end to end: the fixture graph into a ledger, folded as the app folds it", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pbnotes-logseq-"));
  await (await openOrCreate(project)).close();

  let directory = "";
  const report = await (async () => {
    await using writer = await openWriter(project, "pbnotes-import-test");
    directory = writer.directory;
    return await importGraph(diskFolder(FIXTURE), writer, { newId: randomUUID, store: storeBeside(writer.directory) });
  })();

  const ledger = await openOrCreate(project);
  const it = ledger.onEvent(graphFold.initial, graphFold.reduce)[Symbol.asyncIterator]();
  const state: Graph = (await it.next()).value!;
  await ledger.close();

  // The day, its tree, and what was consumed from it.
  const day = getPage(state, "2024-11-04");
  assert.deepEqual(shape(day.blocks), [
    // `\t - ` is two characters in, past `\t- `: under it, beside `\t\t- `.
    [
      "Met with Sam about [[Book]]",
      [["Notes on more\nthan one line", ["mixed tab and space", ["same depth as the one above", ["under it"]]]]],
    ],
    "DONE write it up",
    ["The block that gets referenced", ["hidden child"]],
    "```yaml\n- not: a block\n```",
    `![shot](images/${nameOf(await readFile(path.join(FIXTURE, "assets/shot.png")), "png")})`,
    "{{youtube https://youtu.be/abc}}",
  ]);
  assert.equal(day.blocks[2].id, ID);
  assert.deepEqual(shape(getPage(state, "2024-01-31").blocks), ["TODO plan the year\nSCHEDULED: <2024-01-31 Wed>\nrole:: user"]);

  // The image is beside the writer's log, as a pasted one is.
  const [, link] = /\]\((images\/[^)]+)\)/.exec(day.blocks[4].text)!;
  assert.deepEqual(await readdir(path.join(directory, "images")), [link.slice("images/".length)]);

  // Page properties, tags and aliases.
  assert.deepEqual(getTags(state, "Book"), ["Self Development", "Social Skills"]);
  assert.deepEqual(getAliases(state, "Book"), ["The Book"]);
  assert.deepEqual(getProperties(state, "Book").map((p) => [p.key, p.value]), [["type", "book"]]);
  assert.equal(getPage(state, "The Book").title, "Book");

  // Titles from filenames under :triple-lowbar.
  assert.deepEqual(shape(getPage(state, "Can you tell me about C++?").blocks), ["A question"]);
  assert.deepEqual(shape(getPage(state, "Books/Fiction").blocks), ["A namespaced page"]);

  // Date links open their days; a page named like a day stays its own.
  assert.equal(getPage(state, "Nov 4th, 2024").title, "Nov 4th, 2024");
  assert.deepEqual(shape(getPage(state, "Nov 4th, 2024").blocks), ["A page named like a day"]);
  assert.equal(getPage(state, "April 15th, 2020").title, "2020-04-15");
  assert.deepEqual(getReferences(state, "2020-04-15").map((p) => p.title), ["Book"]);
  assert.ok(getReferences(state, "Book").some((p) => p.title === "2024-11-04"));

  // The ref to the id:: block points at it; the duplicate got its own id.
  assert.equal(getPage(state, "Book").blocks[1].text, `See ((${ID}))`);
  assert.notEqual(getPage(state, "Dupe").blocks[0].id, ID);

  assert.deepEqual(report.counts, { pages: 5, journals: 2, blocks: 20, properties: 1, tags: 2, aliases: 1, images: 1 });
  const found = (kind: Finding["kind"]) => report.findings.filter((f) => f.kind === kind);
  assert.deepEqual(found("skipped").map((f) => f.kind === "skipped" && f.path).sort(), [
    "draws/",
    "logseq/bak/",
    "logseq/config (conflicted copy 2024-02-01).edn",
    "logseq/custom.css",
    "pages/$$/",
    "pages/Old.org",
    "whiteboards/",
  ]);
  assert.deepEqual(found("empty"), [{ kind: "empty", path: "journals/2024_02_01.md" }]);
  assert.deepEqual(found("logbooks-dropped"), [{ kind: "logbooks-dropped", path: "journals/2024_11_04.md", count: 1 }]);
  assert.deepEqual(found("duplicate-id"), [{ kind: "duplicate-id", path: "pages/Dupe.md", id: ID, first: "journals/2024_11_04.md" }]);
  assert.deepEqual(found("dangling-ref"), [{ kind: "dangling-ref", path: "pages/Book.md", id: "6437a1b2-0000-4000-8000-0000000000ff" }]);
  assert.deepEqual(found("page-named-like-a-day").map((f) => f.kind === "page-named-like-a-day" && f.path), ["pages/Nov 4th, 2024.md"]);
  assert.deepEqual(
    found("asset-left").map((f) => f.kind === "asset-left" && [f.target, f.why]),
    [["../assets/doc.pdf", "not-an-image"], ["../assets/missing.png", "missing"]],
  );
  assert.deepEqual(found("config-missing"), []);
});
