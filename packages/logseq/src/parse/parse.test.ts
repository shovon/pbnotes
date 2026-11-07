/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parse.ts";
import type { Tree } from "./parse.ts";

/** A tree as nested `[text, children]`, to compare shapes. */
type Shape = string | [string, Shape[]];
const shape = (trees: Tree[]): Shape[] =>
  trees.map((t) => (t.children.length ? [t.text, shape(t.children)] : t.text));

const ID = "6437a1b2-0000-4000-8000-000000000001";

test("nesting by tabs", () => {
  const { blocks } = parse("- a\n\t- b\n\t\t- c\n- d");
  assert.deepEqual(shape(blocks), [["a", [["b", ["c"]]]], "d"]);
});

test("nesting by spaces", () => {
  const { blocks } = parse("- a\n  - b\n    - c\n  - d\n- e");
  assert.deepEqual(shape(blocks), [["a", [["b", ["c"]], "d"]], "e"]);
});

test("nesting by tab-and-space mixes: depth is from the parent, not a fixed width", () => {
  // `\t - ` and `\t\t- ` are both two characters in: siblings.
  const { blocks } = parse("- a\n\t - b\n\t\t- c\n\t\t\t- d\n\t- e");
  assert.deepEqual(shape(blocks), [["a", ["b", ["c", ["d"]], "e"]]]);
});

test("a block on more than one line, joined with its indentation gone", () => {
  const { blocks } = parse("- first\n  second\n\t- child\n\t  more\n\t    indented");
  assert.deepEqual(shape(blocks), [["first\nsecond", ["child\nmore\n  indented"]]]);
});

test("a blank line inside a block stays; blank lines after it do not", () => {
  const { blocks } = parse("- one\n\n  two\n\n\n- three\n");
  assert.deepEqual(shape(blocks), ["one\n\ntwo", "three"]);
});

test("a bare - is an empty block", () => {
  const { blocks } = parse("- a\n-\n- b\n\t-");
  assert.deepEqual(shape(blocks), ["a", "", ["b", [""]]]);
});

test("a - line inside a code fence is content, at the top", () => {
  const { blocks } = parse("- ```\n  - not a block\n  ```\n- next");
  assert.deepEqual(shape(blocks), ["```\n- not a block\n```", "next"]);
});

test("a - line inside a code fence is content, nested and deeper", () => {
  const text = [
    "- top",
    "\t- code:",
    "\t  ```yaml",
    "\t  - a: 1",
    "\t    - b: 2",
    "\t  - c",
    "\t  ```",
    "\t\t- under",
    "- after",
  ].join("\n");
  assert.deepEqual(shape(parse(text).blocks), [
    ["top", [["code:\n```yaml\n- a: 1\n  - b: 2\n- c\n```", ["under"]]]],
    "after",
  ]);
});

test("a fence opened on the block's own line, and a ~~~ fence", () => {
  const { blocks } = parse("- ~~~\n  - x\n  ~~~\n  - y");
  assert.deepEqual(shape(blocks), [["~~~\n- x\n~~~", ["y"]]]);
});

test("code in a line is not a fence", () => {
  const { blocks } = parse("- run ```ls``` here\n- next");
  assert.deepEqual(shape(blocks), ["run ```ls``` here", "next"]);
});

test("a pre-block with properties only", () => {
  const parsed = parse("title:: My Page\ntags:: #[[A]] #[[B]]\ntype:: book\n\n- body");
  assert.deepEqual(parsed.properties, [["title", "My Page"], ["tags", "#[[A]] #[[B]]"], ["type", "book"]]);
  assert.deepEqual(shape(parsed.blocks), ["body"]);
});

test("a pre-block with text becomes the first block", () => {
  const parsed = parse("type:: note\nSome loose text\nmore\n- body");
  assert.deepEqual(parsed.properties, [["type", "note"]]);
  assert.deepEqual(shape(parsed.blocks), ["Some loose text\nmore", "body"]);
});

test("an empty file", () => {
  assert.deepEqual(parse(""), { properties: [], blocks: [], logbooks: 0 });
});

test("id:: as a block's first line is consumed, the rest kept", () => {
  const [block] = parse(`- id:: ${ID}\n  the text`).blocks;
  assert.equal(block.id, ID);
  assert.equal(block.text, "the text");
});

test("id:: as the first line, and collapsed:: after the text, both consumed", () => {
  const [block] = parse(`- id:: ${ID}\n  the text\n  collapsed:: true\n  role:: user`).blocks;
  assert.equal(block.id, ID);
  assert.equal(block.text, "the text\nrole:: user");
});

test("id:: after the block's text is consumed", () => {
  const [block] = parse(`- the text\n  id:: ${ID}\n  role:: user`).blocks;
  assert.equal(block.id, ID);
  assert.equal(block.text, "the text\nrole:: user");
});

test("collapsed:: goes, other properties stay", () => {
  const [block] = parse("- text\n  collapsed:: true\n  role:: user\n\t- child").blocks;
  assert.equal(block.text, "text\nrole:: user");
});

test("an id:: that is not among the leading properties stays as text", () => {
  const [block] = parse(`- text\n  more\n  id:: ${ID}`).blocks;
  assert.equal(block.id, undefined);
  assert.equal(block.text, `text\nmore\nid:: ${ID}`);
});

test("a :LOGBOOK: drawer is dropped and counted", () => {
  const text = "- DONE task\n  :LOGBOOK:\n  CLOCK: [2024-01-01 Mon 10:00]--[2024-01-01 Mon 11:00] =>  01:00:00\n  :END:\n  after";
  const parsed = parse(text);
  assert.deepEqual(shape(parsed.blocks), ["DONE task\nafter"]);
  assert.equal(parsed.logbooks, 1);
});

test("an unclosed :LOGBOOK: stays as text", () => {
  const parsed = parse("- a\n  :LOGBOOK:\n  CLOCK: x");
  assert.equal(parsed.blocks[0].text, "a\n:LOGBOOK:\nCLOCK: x");
  assert.equal(parsed.logbooks, 0);
});

test("macros, task markers and scheduling stay as text", () => {
  const text = "- {{youtube https://youtu.be/x}}\n- TODO thing\n  SCHEDULED: <2024-01-01 Mon>\n- {{query (todo now)}}";
  assert.deepEqual(shape(parse(text).blocks), [
    "{{youtube https://youtu.be/x}}",
    "TODO thing\nSCHEDULED: <2024-01-01 Mon>",
    "{{query (todo now)}}",
  ]);
});

test("Windows line endings", () => {
  assert.deepEqual(shape(parse("- a\r\n\t- b\r\n").blocks), [["a", ["b"]]]);
});

test("YAML front matter is page properties, quotes gone", () => {
  const parsed = parse('---\ntitle: /r/tressless: "7 months of progress"\nkind: \'it\'\'s\'\n---\n\n- body');
  assert.deepEqual(parsed.properties, [["title", '/r/tressless: "7 months of progress"'], ["kind", "it's"]]);
  assert.deepEqual(shape(parsed.blocks), ["body"]);
});

test("a front-matter value on the lines after its key is joined onto it", () => {
  const parsed = parse("---\ntitle: \nHow To Hire And Manage\nVirtual Assistants\n---\n- body");
  assert.deepEqual(parsed.properties, [["title", "How To Hire And Manage Virtual Assistants"]]);
  assert.deepEqual(shape(parsed.blocks), ["body"]);
});

test("front matter and :: properties together, and an unclosed --- is text", () => {
  assert.deepEqual(parse("---\ntitle: A\n---\ntype:: b\n- x").properties, [["title", "A"], ["type", "b"]]);
  assert.deepEqual(shape(parse("---\ntitle: A\n- x").blocks), ["---\ntitle: A", "x"]);
});
