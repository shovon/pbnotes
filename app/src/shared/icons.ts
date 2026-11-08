/**
 * What choosing a page's icon (#323) keeps on the bench: the slot name and
 * the shape of its value, which main and the renderer must agree on. Each
 * side checks a value with its own code (`features/icons/` in main, `kept/`
 * in the renderer).
 */

export const ICON_SLOTS = {
  /** The emoji picked lately for a page's icon, most recent first. */
  recentEmoji: 'recent-emoji',
} as const;
