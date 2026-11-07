/**
 * The steps along a trail: where the view is, kept as how it got there. Pure,
 * so they run under `node --test` with nothing around them; the trail is
 * part of `TabState` (`Tab/state/`), which `ProjectView` holds and `Tab` steps.
 */
import { canonicalize } from "@pbnotes/graph";
import type { Place } from "../../../shared/graph.ts";

/** The All pages list (#200) as a stop: a place of its own, on no page. */
export const ALL_PAGES = "all-pages";

/**
 * A stop on the trail: a place, the journal, which is `undefined` as it is
 * everywhere else (`graph:view` with no place is the journal), or the list
 * of every page. An empty trail is the journal too: where a project starts.
 */
export type Stop = Place | undefined | typeof ALL_PAGES;

/** The place a stop is, or undefined for one on no page: the journal or the list. */
export function placeOf(stop: Stop): Place | undefined {
  return stop === ALL_PAGES ? undefined : stop;
}

/** What a stop is called on the way back to it. */
export function label(stop: Stop): string {
  if (stop === undefined) return "Journal";
  if (stop === ALL_PAGES) return "All pages";
  return stop.page;
}

/** By `canonicalize`: `[[mira]]` followed from `Mira` is the page already showing. */
const same = (a: Stop, b: Place) => {
  const at = placeOf(a);
  return at !== undefined && canonicalize(at.page) === canonicalize(b.page) && at.block === b.block;
};

/**
 * A link followed. One to the page already showing — every block listed
 * under a page as a reference to it holds one — is nothing to do, and so is
 * a zoom into the block already zoomed.
 */
export function go(trail: Stop[], next: Place): Stop[] {
  return same(trail.at(-1), next) ? trail : [...trail, next];
}

/**
 * To the journal, as a stop of its own, so back returns from it like from a
 * page. Nothing to do on the journal already: an empty trail, or one that
 * ends in a journal stop. So a trail never starts with a journal stop, and
 * never holds two in a row.
 */
export function home(trail: Stop[]): Stop[] {
  return trail.length === 0 || trail.at(-1) === undefined ? trail : [...trail, undefined];
}

/**
 * To the list of every page, as a stop of its own, so back returns to it
 * from a page opened off it. Nothing to do on the list already.
 */
export function browse(trail: Stop[]): Stop[] {
  return trail.at(-1) === ALL_PAGES ? trail : [...trail, ALL_PAGES];
}

/** One step back; from the first page that is the journal. */
export function back(trail: Stop[]): Stop[] {
  return trail.slice(0, -1);
}

/**
 * The zoom moved rather than followed: the zoomed block is gone, and the
 * view lands on what it was under — or on the whole page. In place of the
 * last stop, not after it, so back does not return to a block that is not
 * there; and not twice in a row, so back is never a step that goes nowhere.
 */
export function rezoom(trail: Stop[], block?: string): Stop[] {
  const rest = trail.slice(0, -1);
  const next = { page: placeOf(trail.at(-1))?.page ?? "", block };
  return same(rest.at(-1), next) ? rest : [...rest, next];
}

/**
 * Off a page that was just deleted: back past every stop at the end of the
 * trail that is on it, the page itself and any zoom into one of its blocks,
 * to the first that is somewhere else. A journal stop is on no page, and
 * neither is the list of every page, so either is where this stops. With nothing left, the journal; and a journal stop
 * left first on the trail goes too, since the empty trail is already the
 * journal and back from it would go nowhere.
 */
export function leave(trail: Stop[], page: string): Stop[] {
  const key = canonicalize(page);
  let end = trail.length;
  while (end > 0) {
    const stop = placeOf(trail[end - 1]);
    if (stop === undefined || canonicalize(stop.page) !== key) break;
    end--;
  }
  const kept = end === trail.length ? trail : trail.slice(0, end);
  return kept.length === 1 && kept[0] === undefined ? [] : kept;
}

/**
 * The page `from` is now called `to` (#109): every stop on it, zoom kept,
 * names `to` instead, by `canonicalize`. The same trail when none was on it.
 */
export function renamed(trail: Stop[], from: string, to: string): Stop[] {
  const key = canonicalize(from);
  let changed = false;
  const next = trail.map((stop) => {
    const at = placeOf(stop);
    if (at === undefined || canonicalize(at.page) !== key || at.page === to) return stop;
    changed = true;
    return { ...at, page: to };
  });
  return changed ? next : trail;
}
