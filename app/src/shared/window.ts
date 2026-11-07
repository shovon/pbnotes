/**
 * The window a renderer is drawn in, as far as it asks main about it. The
 * channels and the surface exposed on `window.pbnotes.window` by the
 * preload bridge. Types and constants only, as everything in `shared/`.
 */
export const WINDOW_CHANNELS = {
  close: 'window:close',
  /**
   * Main to renderer: a tab item was chosen in the menu, by click or key,
   * with this window focused (#304). Carries which item, and nothing else.
   */
  tab: 'window:tab',
} as const;

/** The menu's tab items (#304): New Tab, Close Tab, Next Tab and Previous Tab. */
export type TabItem = 'new' | 'close' | 'next' | 'previous';

export type WindowApi = {
  /**
   * Closes the window that asks, the way its close button does, so what
   * happens when a window closes (its size and place kept, the app quitting
   * after the last one on Windows and Linux) happens. Closing the last tab
   * (#303) is the reason: a renderer's own `window.close()` skips it.
   */
  close(): Promise<void>;
  /**
   * Calls `listener` with the item when one of the menu's tab items is
   * chosen with this window focused (#304). The window decides what it
   * does: there are no tabs without a project open. Returns an unsubscribe.
   */
  onTab(listener: (item: TabItem) => void): () => void;
};
