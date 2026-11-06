/**
 * How wide the right sidebar is (#287), as its edge is dragged: never so
 * narrow a card cannot show a line, and never so wide the page beside it
 * has no room. Pure, so it runs under `node --test`; `Aside` reads the
 * pointer and the window.
 */

/** The narrowest it goes, in pixels. */
export const MIN_WIDTH = 240;
/** How wide it opens, in pixels. */
export const INITIAL_WIDTH = 360;
/** The room always left for the rest of the window, in pixels. */
export const ROOM_LEFT = 360;

/**
 * The width for an edge dragged to `x` in a window `window` wide: the
 * distance from `x` to the window's right side, held between the bounds.
 * In a window too narrow for both bounds, the narrowest wins.
 */
export function widthAt(x: number, window: number): number {
  return fit(window - x, window);
}

/**
 * `width` held between the bounds for a window `window` wide: what is drawn
 * when the window narrows under a width chosen in a wider one, which is kept
 * for when it widens again.
 */
export function fit(width: number, window: number): number {
  const most = Math.max(MIN_WIDTH, window - ROOM_LEFT);
  return Math.round(Math.min(most, Math.max(MIN_WIDTH, width)));
}
