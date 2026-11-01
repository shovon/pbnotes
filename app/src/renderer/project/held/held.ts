/**
 * Which view a window keeps: the one with the highest fold version for the
 * place it is on. An answer for a place the window has since left, or older
 * than the one held for this place, loses.
 *
 * Pure, so the rule runs under `node --test`; `ProjectView` holds the view.
 */
import type { Place, PlaceView } from '../../../shared/pages.ts';

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
