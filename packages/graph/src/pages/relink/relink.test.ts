import { test } from "node:test";
import assert from "node:assert/strict";
import { relink } from "./relink.ts";
import { canonicalize } from "../../titles/canonicalize.ts";

/** Links to `Bridal Falls`, by any spelling, now name `to`. */
const to = (text: string, name = "Lake Lindeman") =>
  relink(text, (page) => canonicalize(page) === "bridal falls", name);

test("every form names the new page, in the form it was written", () => {
  assert.equal(to("see [[Bridal Falls]]"), "see [[Lake Lindeman]]");
  assert.equal(to("see #[[Bridal Falls]]"), "see #[[Lake Lindeman]]");
  assert.equal(to("see [the falls]([[Bridal Falls]])"), "see [the falls]([[Lake Lindeman]])");
});

test("an alias whose page has no space keeps its label, formatting and all", () => {
  const text = "see [**the** falls]([[BridalFalls]]) now";
  const out = relink(text, (page) => page === "BridalFalls", "Lake");
  assert.equal(out, "see [**the** falls]([[Lake]]) now");
});

test("a bare tag stays bare when it can, and takes brackets when it cannot", () => {
  const tag = (text: string, name: string) => relink(text, (page) => page === "falls", name);
  assert.equal(tag("went #falls.", "lake"), "went #lake.");
  assert.equal(tag("went #falls.", "Lake Lindeman"), "went #[[Lake Lindeman]].");
});

test("matching is the caller's: any spelling it picks is rewritten", () => {
  assert.equal(to("[[bridal falls]] and [[ BRIDAL FALLS ]]"), "[[Lake Lindeman]] and [[Lake Lindeman]]");
});

test("code, math, a longer title and a URL are left as written", () => {
  for (const text of [
    "`[[Bridal Falls]]`",
    "```\n[[Bridal Falls]]\n```",
    "$[[Bridal Falls]]$",
    "[[Bridal Falls Trail]]",
    "https://example.com/#[[Bridal Falls]]",
  ]) {
    assert.equal(to(text), text);
  }
});

test("everything around a link is kept byte for byte", () => {
  const text = "- a  **bold** [[Bridal Falls]]\n\n> quote #[[bridal falls]] `code`  \n";
  assert.equal(to(text), "- a  **bold** [[Lake Lindeman]]\n\n> quote #[[Lake Lindeman]] `code`  \n");
});

test("links inside formatting and a normal link's label are reached", () => {
  assert.equal(to("**[[Bridal Falls]]** and [see #[[Bridal Falls]]](https://x.com)"),
    "**[[Lake Lindeman]]** and [see #[[Lake Lindeman]]](https://x.com)");
});

test("a block ref and other pages are left alone", () => {
  const text = "((abc)) [[Other]] #other [x](((abc)))";
  assert.equal(to(text), text);
});

test("text with nothing to change is handed back as it is", () => {
  const text = "nothing here";
  assert.equal(to(text), text);
});
