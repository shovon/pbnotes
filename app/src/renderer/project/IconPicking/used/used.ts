/**
 * The emoji used lately for page icons (#323), as the bench keeps them per
 * project on this machine: most recent first, once each. Pure, so it runs
 * under `node --test`.
 */

/** How many are kept: two rows of the picker's grid. */
export const KEPT = 16;

/** `recent` with `emoji` moved or added to the front, cut to `KEPT`. */
export function used(recent: readonly string[], emoji: string): string[] {
  return [emoji, ...recent.filter((it) => it !== emoji)].slice(0, KEPT);
}
