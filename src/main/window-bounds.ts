/**
 * Fitting a remembered window rectangle to the displays attached *now*.
 *
 * Pure, and separate from `window-state.ts`, because this is the only part
 * with a wrong answer: everything else there is a read, a write or an event
 * subscription, while getting this wrong puts the window somewhere the user
 * cannot reach it.
 */

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Electron's constructor default is 800x600, which is a sample-app size, not
 * a text-editor one. A shipped note-taker wants room for the text column plus
 * its margins — 1200x800 is where VS Code, Slack and Notion all land.
 */
export const DEFAULT_SIZE = { width: 1200, height: 800 };

/** Below this the picker's columns start fighting each other. */
export const MIN_SIZE = { width: 720, height: 480 };

/**
 * Undock a laptop and the remembered position is out on a monitor that no
 * longer exists. Electron will place a window there quite happily, entirely
 * off-screen, with no way for the user to drag it back — so a rectangle that
 * no longer overlaps the work area loses its position and keeps only its size,
 * and Electron centres it.
 *
 * `null` is a first launch, which takes the default size through the same
 * clamp: 1200x800 is bigger than the work area of a 1366x768 panel, and only
 * macOS shrinks an oversized window on the way in.
 */
export function fitToWorkArea(
  saved: Rect | null,
  workArea: Rect,
): { width: number; height: number; x?: number; y?: number } {
  const wanted = saved ?? DEFAULT_SIZE;
  const size = {
    width: Math.min(Math.max(wanted.width, MIN_SIZE.width), workArea.width),
    height: Math.min(Math.max(wanted.height, MIN_SIZE.height), workArea.height),
  };
  if (!saved) return size;

  const overlaps =
    saved.x < workArea.x + workArea.width &&
    saved.x + saved.width > workArea.x &&
    saved.y < workArea.y + workArea.height &&
    saved.y + saved.height > workArea.y;

  return overlaps ? { ...size, x: saved.x, y: saved.y } : size;
}
