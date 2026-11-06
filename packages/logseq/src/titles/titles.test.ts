/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayOfFile, titleOfFile } from "./titles.ts";

test("triple-lowbar: ___ is a slash, and percent escapes are decoded", () => {
  assert.equal(titleOfFile("Books___Fiction", "triple-lowbar"), "Books/Fiction");
  assert.equal(titleOfFile("Can you tell me about C++%3F", "triple-lowbar"), "Can you tell me about C++?");
  assert.equal(titleOfFile("Use $%5CLaTeX$ to write", "triple-lowbar"), "Use $\\LaTeX$ to write");
  assert.equal(titleOfFile("v1.2 notes", "triple-lowbar"), "v1.2 notes");
});

test("legacy: a dot is a slash, and so is %2F", () => {
  assert.equal(titleOfFile("Books.Fiction", "legacy"), "Books/Fiction");
  assert.equal(titleOfFile("Books%2FFiction", "legacy"), "Books/Fiction");
  assert.equal(titleOfFile("v1%2E2", "legacy"), "v1.2");
});

test("a broken escape is left as written", () => {
  assert.equal(titleOfFile("100%25 sure %E0%A4", "triple-lowbar"), "100% sure %E0%A4");
});

test("a journal name, under the default format and a custom one", () => {
  assert.equal(dayOfFile("2024_01_31", "yyyy_MM_dd"), "2024-01-31");
  assert.equal(dayOfFile("2024-01-31", "yyyy-MM-dd"), "2024-01-31");
  assert.equal(dayOfFile("31.01.2024", "dd.MM.yyyy"), "2024-01-31");
});

test("a journal name that doesn't parse", () => {
  assert.equal(dayOfFile("2024_13_01", "yyyy_MM_dd"), undefined);
  assert.equal(dayOfFile("scratch", "yyyy_MM_dd"), undefined);
});
