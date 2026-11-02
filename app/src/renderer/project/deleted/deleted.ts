/**
 * Telling that the page on show was deleted while the window was on it:
 * by another window, or another machine through sync. The page going empty
 * is not enough, since someone may have deleted its last block by hand; the
 * fold counts every delete of a page (`deletions`), and this is that count
 * going up between two answers for the same page.
 *
 * Pure, so the rule runs under `node --test`; `ProjectView` acts on it.
 */
import { canonicalize } from '@pbnotes/graph';
import type { Held } from '../held/held.ts';

/**
 * The title of the page deleted between `before` and `after`, or undefined.
 * Only for a page's own view, zoomed or not: the journal shows many days,
 * and one deleted from its own page elsewhere simply leaves it. Coming back
 * to a page deleted while the window was somewhere else is not this: the
 * view before that was for another place.
 */
export function deletedSince(before: Held | null, after: Held): string | undefined {
  if (!before?.place || !after.place) return undefined;
  if (canonicalize(before.place.page) !== canonicalize(after.place.page)) return undefined;
  const was = before.view.showing[0];
  const now = after.view.showing[0];
  if (!was || !now || now.deletions <= was.deletions) return undefined;
  return now.page.title;
}
