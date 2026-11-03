/**
 * How much of a long list shows before it is expanded. Pure, so the rule
 * runs under `node --test`.
 */

/** How many show before a list collapses. A starting point, to be tuned (#210). */
export const LIMIT = 10;

/**
 * What of `all` shows: everything when expanded or within `limit`, else the
 * first `limit`. `hidden` is how many are left out, 0 when none are.
 */
export function collapse<T>(
  all: readonly T[],
  expanded: boolean,
  limit = LIMIT,
): { shown: T[]; hidden: number } {
  if (expanded || all.length <= limit) return { shown: [...all], hidden: 0 };
  return { shown: all.slice(0, limit), hidden: all.length - limit };
}
