/**
 * Which view a window keeps: the one with the highest fold version for the
 * place it is on. An answer for a place the window has since left, or older
 * than the one held for this place, loses.
 *
 * Pure, so the rule runs under `node --test`; `Tab` holds the view.
 */
import type { Place, PlaceView } from '../../../shared/graph.ts';

/** A view, and the place it was asked for: none is the journal. */
export type Held = { place: Place | undefined; view: PlaceView };

/** The same place, exactly as the trail holds it. Two journals are the same. */
export function samePlace(a: Place | undefined, b: Place | undefined): boolean {
  return a?.page === b?.page && a?.block === b?.block;
}

/**
 * What to keep once `answer` arrives while the window is `on` a place. A
 * view held for another place is replaced by any answer for this one: it
 * was never this place's to compare against.
 */
export function keep(held: Held | null, on: Place | undefined, answer: Held): Held | null {
  if (!samePlace(answer.place, on)) return held;
  if (held && samePlace(held.place, on) && held.view.version > answer.view.version) {
    return held;
  }
  return answer;
}

/** A tab's page and its icon, as its last view showed them (#323). */
export type HeldIcon = { page: string; icon: string };

/**
 * The icon `held` shows for its page, with the page it is for: none for the
 * journal, or a page with no icon. Under a zoom it is still the page's.
 */
export function heldIcon(held: Held): HeldIcon | undefined {
  const icon = held.view.showing[0]?.icon;
  return held.place && icon !== undefined ? { page: held.place.page, icon } : undefined;
}

/**
 * The icon to draw on a tab that is `on` a place: the one last held, while
 * it is for the page the tab is on. Just after the tab moves, the old page's
 * icon is not drawn beside the new page's name.
 */
export function tabIcon(kept: HeldIcon | undefined, on: Place | undefined): string | undefined {
  return kept && on && kept.page === on.page ? kept.icon : undefined;
}
