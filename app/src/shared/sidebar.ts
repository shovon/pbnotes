/**
 * What the sidebar (#184) keeps on the bench: the slot names and the shape of
 * each value, which main and the renderer must agree on. Each side checks a
 * value with its own code (`features/sidebar/` in main, `kept/` in the
 * renderer): a check is a function, and `src/shared` holds types and
 * constants only.
 */

export const SIDEBAR_SLOTS = {
  /** The pages opened lately, newest first, as titles. */
  recentPages: 'recent-pages',
  /** Whether the sidebar is collapsed. */
  sidebar: 'sidebar',
  /** Whether the Recent section is collapsed to its heading (#299). */
  recentSection: 'recent-section',
} as const;

/** Whether something is collapsed: the sidebar, or its Recent section. */
export type SidebarState = { collapsed: boolean };
