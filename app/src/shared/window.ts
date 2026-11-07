/**
 * The window a renderer is drawn in, as far as it asks main about it. The
 * channels and the surface exposed on `window.pbnotes.window` by the
 * preload bridge. Types and constants only, as everything in `shared/`.
 */
export const WINDOW_CHANNELS = {
  close: 'window:close',
} as const;

export type WindowApi = {
  /**
   * Closes the window that asks, the way its close button does, so what
   * happens when a window closes (its size and place kept, the app quitting
   * after the last one on Windows and Linux) happens. Closing the last tab
   * (#303) is the reason: a renderer's own `window.close()` skips it.
   */
  close(): Promise<void>;
};
