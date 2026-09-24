/**
 * Where the main window was last time.
 *
 * Lives in `notes.db` with the rest of what this machine remembers, and is the
 * one piece of state here that is safe to lose: a missing row just means the
 * window opens at its default size, centred.
 */
import { screen } from "electron";
import type { BrowserWindow, Rectangle } from "electron";
import { getDatabase } from "./db";
import { MIN_SIZE, fitToWorkArea } from "./window-bounds";

export { MIN_SIZE };

type Saved = Rectangle & { maximized: boolean };

function read(): Saved | null {
  const row = getDatabase()
    .prepare(
      `SELECT x, y, width, height, maximized FROM window_state
         WHERE only_row = 1`,
    )
    .get() as
    | {
        x: number;
        y: number;
        width: number;
        height: number;
        maximized: number;
      }
    | undefined;

  if (!row) return null;
  return { ...row, maximized: row.maximized === 1 };
}

function write(state: Saved): void {
  getDatabase()
    .prepare(
      `INSERT INTO window_state (only_row, x, y, width, height, maximized)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT (only_row) DO UPDATE SET
         x = excluded.x, y = excluded.y,
         width = excluded.width, height = excluded.height,
         maximized = excluded.maximized`,
    )
    .run(state.x, state.y, state.width, state.height, state.maximized ? 1 : 0);
}

export function restoreWindowBounds(): {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
} {
  const saved = read();
  const { workArea } = saved
    ? screen.getDisplayMatching(saved)
    : screen.getPrimaryDisplay();

  return {
    ...fitToWorkArea(saved, workArea),
    maximized: saved?.maximized ?? false,
  };
}

/**
 * Saves on a trailing timer because resizing fires these events continuously,
 * and on close because the last drag may not have settled yet.
 */
export function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;

  const save = () => {
    if (window.isDestroyed()) return;
    // Normal bounds, so un-maximizing lands back on a real size rather than
    // filling the screen forever. Fullscreen has no meaningful bounds to
    // record, and is deliberately not remembered: an app that reopens
    // fullscreen without being asked to is a nuisance.
    if (window.isFullScreen()) return;
    write({ ...window.getNormalBounds(), maximized: window.isMaximized() });
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };

  window.on("resize", schedule);
  window.on("move", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  window.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
