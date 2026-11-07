/**
 * Telling that the page on show was renamed while the window was on it: by
 * another window, or another machine through sync (#109). The window asks for
 * the old title, the alias the rename left opens the page, and it comes back
 * under its new one. A case-only rename (#89) comes back with the same key
 * and a new spelling.
 *
 * Only when the answer before was the place's own page: a window on `[[JS]]`
 * showing `JavaScript` is not on `JS`'s page, and `JS` losing its alias is
 * not a rename. A day renamed away is not seen here: its old date opens the
 * empty day, which no answer tells from its blocks being deleted.
 *
 * Pure, so the rule runs under `node --test`; `Tab` acts on it.
 */
import { canonicalize, dateOf } from '@pbnotes/graph';
import type { Held } from '../held/held.ts';

/** The key a name opens as its own page: a date name's day, or itself. */
const keyOf = (name: string) => dateOf(name) ?? canonicalize(name);

/**
 * The page renamed between `before` and `after`, as each shows it, or
 * undefined. Only for a page's own view, zoomed or not. Coming back to a
 * page from elsewhere is not this: the view before was for another place.
 */
export function renamedSince(before: Held | null, after: Held): { from: string; to: string } | undefined {
  if (!before?.place || !after.place) return undefined;
  if (keyOf(before.place.page) !== keyOf(after.place.page)) return undefined;
  const from = before.view.showing[0]?.page.title;
  const to = after.view.showing[0]?.page.title;
  if (from === undefined || to === undefined || from === to) return undefined;
  return keyOf(from) === keyOf(before.place.page) ? { from, to } : undefined;
}
