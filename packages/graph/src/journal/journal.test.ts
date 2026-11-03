/**
 * Run with: npm test
 *
 * The built-in date names (#221): what reads as a day, and a day's names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateOf, namesOf } from "./journal.ts";

test("both formats read as their day, in any case and with space around them", () => {
  assert.equal(dateOf("Nov 4th, 2024"), "2024-11-04");
  assert.equal(dateOf("November 4th, 2024"), "2024-11-04");
  assert.equal(dateOf("  nov 4TH, 2024 "), "2024-11-04");
  assert.equal(dateOf("April 15th, 2020"), "2020-04-15");
  assert.equal(dateOf("Sep 4th, 2025"), "2025-09-04");
});

test("every ordinal from 1st to 31st is the one English writes, and no other", () => {
  const right = (day: number) => {
    if (day % 100 >= 11 && day % 100 <= 13) return "th";
    return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  };
  for (let day = 1; day <= 31; day++) {
    const iso = `2024-01-${String(day).padStart(2, "0")}`;
    assert.equal(dateOf(`Jan ${day}${right(day)}, 2024`), iso, `${day}${right(day)}`);
    for (const wrong of ["st", "nd", "rd", "th"].filter((it) => it !== right(day))) {
      assert.equal(dateOf(`Jan ${day}${wrong}, 2024`), undefined, `${day}${wrong}`);
    }
  }
});

test("only a day the month has is a date", () => {
  assert.equal(dateOf("Feb 29th, 2024"), "2024-02-29");
  assert.equal(dateOf("Feb 29th, 2023"), undefined);
  assert.equal(dateOf("Feb 29th, 1900"), undefined);
  assert.equal(dateOf("Feb 29th, 2000"), "2000-02-29");
  assert.equal(dateOf("Feb 30th, 2024"), undefined);
  assert.equal(dateOf("Apr 31st, 2024"), undefined);
});

test("what isn't one of the two formats isn't a date", () => {
  for (const name of [
    "Sept 4th, 2025",
    "Nov 4, 2024",
    "Nov 04th, 2024",
    "Nov 4th 2024",
    "Nov  4th, 2024",
    "4th Nov, 2024",
    "Mon, 4th Nov 2024",
    "11/04/2024",
    "2024-11-04",
    "Nov 4th, 24",
    "Nov 0th, 2024",
    "Novem 4th, 2024",
    "",
  ]) {
    assert.equal(dateOf(name), undefined, JSON.stringify(name));
  }
});

test("a day's names are the two formats, once for May, and read back as the day", () => {
  assert.deepEqual(namesOf("2024-11-04"), ["Nov 4th, 2024", "November 4th, 2024"]);
  assert.deepEqual(namesOf("2024-05-01"), ["May 1st, 2024"]);
  assert.deepEqual(namesOf("2024-01-22"), ["Jan 22nd, 2024", "January 22nd, 2024"]);
  for (const day of ["2024-02-29", "2020-04-15", "2025-12-31", "2023-09-13"]) {
    for (const name of namesOf(day)) assert.equal(dateOf(name), day, name);
  }
});

test("a title that isn't a real day has no names", () => {
  assert.deepEqual(namesOf("2024-13-01"), []);
  assert.deepEqual(namesOf("2023-02-29"), []);
  assert.deepEqual(namesOf("2024-11-00"), []);
  assert.deepEqual(namesOf("Nov 4th, 2024"), []);
  assert.deepEqual(namesOf("1984"), []);
});
