/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECENT_LIMIT, forget, isShowing, visit } from "./recent.ts";

test("a page opened goes first", () => {
  assert.deepEqual(visit(["Bar", "Baz"], "Mira"), ["Mira", "Bar", "Baz"]);
});

test("a page opened again moves to the front, once", () => {
  assert.deepEqual(visit(["Bar", "Mira", "Baz"], "Mira"), ["Mira", "Bar", "Baz"]);
});

test("pages that canonicalize alike are one entry, in the spelling last opened", () => {
  assert.deepEqual(visit(["Bar", "mira"], "Mira"), ["Mira", "Bar"]);
});

test("the list keeps the newest ten", () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `p${i}`);
  const recent = eleven.reduce<string[]>((list, page) => visit(list, page), []);
  assert.equal(recent.length, RECENT_LIMIT);
  assert.equal(recent[0], "p10");
  assert.ok(!recent.includes("p0"));
});

test("the page already first, spelled the same, is the same list", () => {
  const recent = ["Mira", "Bar"];
  assert.equal(visit(recent, "Mira"), recent);
});

test("a journal day is a page like any other", () => {
  assert.deepEqual(visit(["Mira"], "2026-10-28"), ["2026-10-28", "Mira"]);
});

test("forget takes a page off, in any spelling", () => {
  assert.deepEqual(forget(["Mira", "Bar"], "mira"), ["Bar"]);
});

test("forget a page not on the list is the same list", () => {
  const recent = ["Mira"];
  assert.equal(forget(recent, "Bar"), recent);
});

test("the page on screen is told apart in any spelling, and the journal is no page", () => {
  assert.equal(isShowing("Mira", "mira"), true);
  assert.equal(isShowing("Mira", "Bar"), false);
  assert.equal(isShowing("Mira", undefined), false);
});
