import { canonicalize } from "../canonicalize/canonicalize.ts";

/**
 * What makes a title a journal day. Whoever writes picks the day, so the fold
 * never has to hold an opinion about the user's timezone; this only tells the
 * journal apart from the pages that links name.
 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today as `YYYY-MM-DD`, in the user's local time. Not `toISOString()`, which
 * is UTC and hands the wrong page to anyone whose evening is already tomorrow
 * in Greenwich.
 *
 * Shared because everyone who writes the journal needs the same day: the
 * app's main, its renderer and the CLI.
 */
export function today(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// ── Built-in names ──────────────────────────────────────────────────────────
//
// A day answers to its date in words, in the formats below, with nothing
// written (#221). Part of what a graph means, like `canonicalize`: adding a
// format makes links already written in it open their day. See the README.

/** The months, short (`MMM`) and long (`MMMM`), as Logseq and Roam write them. */
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `1st`, `2nd`, `3rd`, `4th`, `11th`, `12th`, `13th`, `21st`, …: `do`. */
function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th";
  return `${day}${suffix}`;
}

/** Days in a month of a year, leap years included. `month` is 1 to 12. */
function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Lowercased month name → its number, for both formats. */
const MONTHS = new Map(
  [...SHORT, ...LONG].map((name, at): [string, number] => [name.toLowerCase(), (at % 12) + 1]),
);

const DATE_NAME = /^([a-z]+) ([1-9]\d?)(st|nd|rd|th), (\d{4})$/;

/**
 * The `YYYY-MM-DD` a name means in one of the built-in formats, `MMM do,
 * yyyy` (`Nov 4th, 2024`) or `MMMM do, yyyy` (`November 4th, 2024`), or
 * undefined. Read through `canonicalize`, so case and the space around it
 * don't matter. A wrong ordinal and a day the month doesn't have are not
 * dates.
 */
export function dateOf(name: string): string | undefined {
  const canonical = canonicalize(name);
  const found = DATE_NAME.exec(canonical);
  if (!found) return undefined;
  const [, word, digits, , yyyy] = found;
  const month = MONTHS.get(word);
  const day = Number(digits);
  const year = Number(yyyy);
  if (month === undefined || day > daysIn(year, month)) return undefined;
  if (`${word} ${ordinal(day)}, ${yyyy}` !== canonical) return undefined;
  return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A day's built-in names, in the formats' order: `Nov 4th, 2024`, then
 * `November 4th, 2024`. One for May, whose names are the same. Empty for a
 * title that isn't a real `YYYY-MM-DD`.
 */
export function namesOf(day: string): string[] {
  if (!DATE_PATTERN.test(day)) return [];
  const [year, month, date] = day.split("-").map(Number);
  if (month < 1 || month > 12 || date < 1 || date > daysIn(year, month)) return [];
  const tail = `${ordinal(date)}, ${String(year).padStart(4, "0")}`;
  return [...new Set([`${SHORT[month - 1]} ${tail}`, `${LONG[month - 1]} ${tail}`])];
}
