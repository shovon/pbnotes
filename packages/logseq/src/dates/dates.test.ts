/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { format, parse } from "./dates.ts";

test("a day in the patterns Logseq ships", () => {
  assert.equal(format("yyyy_MM_dd", "2024-01-31"), "2024_01_31");
  assert.equal(format("MMM do, yyyy", "2024-11-04"), "Nov 4th, 2024");
  assert.equal(format("MMMM do, yyyy", "2020-04-15"), "April 15th, 2020");
  assert.equal(format("EEE do, MMM yyyy", "2024-11-04"), "Mon 4th, Nov 2024");
  assert.equal(format("EEEE, dd.MM.yyyy", "2024-11-04"), "Monday, 04.11.2024");
  assert.equal(format("yyyyMMdd", "2024-11-04"), "20241104");
  assert.equal(format("do 'of' MMMM", "2024-11-22"), "22nd of November");
});

test("a day that is not real is written as nothing", () => {
  assert.equal(format("yyyy_MM_dd", "2023-02-29"), undefined);
  assert.equal(format("yyyy_MM_dd", "nope"), undefined);
});

test("the day a string names, in any case", () => {
  assert.equal(parse("yyyy_MM_dd", "2024_01_31"), "2024-01-31");
  assert.equal(parse("MMM do, yyyy", "nov 4th, 2024"), "2024-11-04");
  assert.equal(parse("EEE, dd-MM-yyyy", "Mon, 04-11-2024"), "2024-11-04");
  assert.equal(parse("yyyyMMdd", "20241104"), "2024-11-04");
});

test("a string that names no real day names none", () => {
  assert.equal(parse("yyyy_MM_dd", "2023_02_29"), undefined);
  assert.equal(parse("yyyy_MM_dd", "2024-01-31"), undefined);
  assert.equal(parse("MMM do, yyyy", "Nov 4st, 2024"), undefined);
  assert.equal(parse("EEE, dd-MM-yyyy", "Tue, 04-11-2024"), undefined);
  assert.equal(parse("MMM do, yyyy", "Foo 4th, 2024"), undefined);
  assert.equal(parse("yyyy_MM_dd", "2024_01_31 extra"), undefined);
});
