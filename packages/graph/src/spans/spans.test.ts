/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spans } from "./spans.ts";

/** Each span as the source it covers, with what it says. */
const read = (text: string) =>
  spans(text).map((it) => ({ ...it, source: text.slice(it.start, it.end) }));

test("a bare ref and a labelled one, each with the source it is", () => {
  const text = "Per ((abc)), and [the survey](((def))).";
  assert.deepEqual(read(text), [
    { kind: "ref", id: "abc", start: 4, end: 11, source: "((abc))" },
    { kind: "ref", id: "def", label: "the survey", start: 17, end: 38, source: "[the survey](((def)))" },
  ]);
});

test("a label keeps the Markdown it was written with", () => {
  const [ref] = spans("[**bold** one](((x)))");
  assert.equal(ref.kind === "ref" ? ref.label : undefined, "**bold** one");
});

test("an image, local or not", () => {
  const text = "A\n\n![](images/abc.png) and ![alt](https://example.com/x.png)";
  assert.deepEqual(
    read(text).map(({ kind, source }) => [kind, source]),
    [
      ["image", "![](images/abc.png)"],
      ["image", "![alt](https://example.com/x.png)"],
    ],
  );
});

test("code, math, a link's brackets and a bare URL hold no ref", () => {
  assert.deepEqual(spans("`((a))` and $((b))$ and [[x ((c))]] and https://a.com/((d))"), []);
  assert.deepEqual(spans("```\n((e))\n```"), []);
});

test("a ref inside formatting and inside a list is still found", () => {
  assert.deepEqual(
    read("- **((a))**\n- _x ((b))_").map((it) => it.source),
    ["((a))", "((b))"],
  );
});
