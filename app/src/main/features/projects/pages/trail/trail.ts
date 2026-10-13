/**
 * The steps along a trail: where the view is, kept as how it got there. Pure,
 * so the three of them run under `node --test` with nothing around them;
 * `pages-ipc.ts` holds the trail these are applied to.
 */
import type { Place } from "../../../../../shared/pages.ts";

const same = (a: Place | undefined, b: Place) =>
  a?.page === b.page && a.block === b.block;

/**
 * A link followed. One to the page already showing — every block listed
 * under a page as a reference to it holds one — is nothing to do, and so is
 * a zoom into the block already zoomed.
 */
export function go(trail: Place[], next: Place): Place[] {
  return same(trail.at(-1), next) ? trail : [...trail, next];
}

/** One step back; from the first page that is the journal. */
export function back(trail: Place[]): Place[] {
  return trail.slice(0, -1);
}

/**
 * The zoom moved rather than followed: the zoomed block is gone, and the
 * view lands on what it was under — or on the whole page. In place of the
 * last stop, not after it, so back does not return to a block that is not
 * there; and not twice in a row, so back is never a step that goes nowhere.
 */
export function rezoom(trail: Place[], block?: string): Place[] {
  const rest = trail.slice(0, -1);
  const next = { page: trail.at(-1)?.page ?? "", block };
  return same(rest.at(-1), next) ? rest : [...rest, next];
}
