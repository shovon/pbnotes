/**
 * How a page is spelled: `canonicalize` key → the first spelling the fold saw.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { get, has, put } from "../immutable/immutable.ts";
import type { ImmutableMap } from "../immutable/immutable.ts";

/**
 * Never overwritten: editing a link away later leaves its spelling as it was.
 * Immutable (#276), so a new spelling costs one key, not a copy of them all.
 */
export type Titles = ImmutableMap<string>;

/**
 * `titles` with a spelling for each of `names` whose key has none yet, in
 * order, so the first of two spellings in one event is the one kept. The same
 * map back when every name already has one.
 */
export function spell(titles: Titles, names: string[]): Titles {
  let next = titles;
  for (const name of names) {
    const key = canonicalize(name);
    if (!has(next, key)) next = put(next, key, name);
  }
  return next;
}

/** How a page is shown: its first spelling, or `title` for one nothing has named. */
export function titleOf(holds: { readonly titles: Titles }, title: string): string {
  return get(holds.titles, canonicalize(title)) ?? title;
}

/** How the page whose `canonicalize`d key is `key` is shown: its first spelling, or the key. */
export function spelled(titles: Titles, key: string): string {
  return get(titles, key) ?? key;
}
