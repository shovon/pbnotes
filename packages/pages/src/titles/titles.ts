/**
 * How a page is spelled: `canonicalize` key → the first spelling the fold saw.
 * Blocks and properties both name pages, so both spell them here.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";

/** Never overwritten: editing a link away later leaves its spelling as it was. */
export type Titles = Map<string, string>;

/**
 * `titles` with a spelling for each of `names` whose key has none yet, in
 * order, so the first of two spellings in one event is the one kept. The same
 * map back when every name already has one.
 */
export function spell(titles: Titles, names: string[]): Titles {
  let next = titles;
  for (const name of names) {
    const key = canonicalize(name);
    if (next.has(key)) continue;
    // Copied once, on the first new name: what was handed in is a checkpoint.
    if (next === titles) next = new Map(titles);
    next.set(key, name);
  }
  return next;
}

/** How a page is shown: its first spelling, or `title` for one nothing has named. */
export function titleOf(holds: { readonly titles: Titles }, title: string): string {
  return holds.titles.get(canonicalize(title)) ?? title;
}
