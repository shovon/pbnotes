/**
 * The pages opened lately, newest first: what the sidebar lists under
 * Recent. Titles only, by `canonicalize`, so `Mira` and `mira` are one entry,
 * shown as the spelling last opened.
 *
 * Pure, so it runs under `node --test`; `ProjectView` holds the list and
 * decides when a page was opened.
 */
import { canonicalize } from "@pbnotes/graph";

/** How many are shown, and kept. */
export const RECENT_LIMIT = 10;

/**
 * `page` was opened: first, wherever it was before, and the list cut to
 * `limit`. The same list when it is first already, spelled the same, so
 * nothing downstream sees a change that is not one.
 */
export function visit(recent: readonly string[], page: string, limit = RECENT_LIMIT): string[] {
  if (recent[0] === page && recent.length <= limit) return recent as string[];
  const key = canonicalize(page);
  return [page, ...recent.filter((it) => canonicalize(it) !== key)].slice(0, limit);
}

/** `page` is gone: off the list. The same list when it was not on it. */
export function forget(recent: readonly string[], page: string): string[] {
  const key = canonicalize(page);
  const kept = recent.filter((it) => canonicalize(it) !== key);
  return kept.length === recent.length ? (recent as string[]) : kept;
}

/** Whether `page` is `title`, the page on screen. */
export const isShowing = (page: string, title: string | undefined) =>
  title !== undefined && canonicalize(page) === canonicalize(title);
