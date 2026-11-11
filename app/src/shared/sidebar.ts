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

export const SIDEBAR_CHANNELS = {
  /**
   * Renderer to main: open the menu for one Recent entry at a point in the
   * window (#366). Answers with what was picked, or null when the menu
   * closes without a pick.
   */
  recentMenu: 'sidebar:recent-menu',
} as const;

/** What a Recent entry's menu answers with: the one item it has (#366). */
export type RecentMenuPick = 'remove';

/** The sidebar's surface on `window.pbnotes.sidebar`. */
export type SidebarApi = {
  /**
   * Opens a Recent entry's menu with its top-left corner at `at`, in window
   * pixels. Main draws it; the window does what was picked. Nothing names
   * the entry: the window already knows which one it opened the menu on.
   */
  recentMenu(at: { x: number; y: number }): Promise<RecentMenuPick | null>;
};
