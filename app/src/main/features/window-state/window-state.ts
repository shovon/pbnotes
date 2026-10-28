/**
 * Where the main window was last time.
 *
 * Lives in `notes.db` with the rest of what this machine remembers, and is the
 * one piece of state here that is safe to lose: a missing row just means the
 * window opens at its default size, centred.
 *
 * Free of `electron` imports, so it runs under `node --test`: the displays and
 * the window are handed in by `index.ts` as the little this reads of them.
 */
import type { DatabaseSync } from "node:sqlite";
import { MIN_SIZE, fitToWorkArea } from "./window-bounds/window-bounds.ts";
import type { Rect } from "./window-bounds/window-bounds.ts";

export { MIN_SIZE };

type Saved = Rect & { maximized: boolean };

/**
 * The work area of the display `saved` is on, or of the primary display for
 * a first launch with nothing saved.
 */
export type WorkAreaFor = (saved: Rect | null) => Rect;

/**
 * What tracking reads of a window and listens to on it, and nothing else of
 * it. One overload per event, so a `BrowserWindow` is one as it is.
 */
export type TrackedWindow = {
  on(event: "resize", listener: () => void): unknown;
  on(event: "move", listener: () => void): unknown;
  on(event: "maximize", listener: () => void): unknown;
  on(event: "unmaximize", listener: () => void): unknown;
  on(event: "close", listener: () => void): unknown;
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  isMaximized(): boolean;
  getNormalBounds(): Rect;
};

/** How long a run of resize and move events has to settle before it is saved. */
const SAVE_AFTER_MS = 400;

/**
 * Where the main window was, kept in `db`, which the caller owns, and fitted
 * to the work area `workAreaFor` says.
 */
export function createWindowState(db: DatabaseSync, workAreaFor: WorkAreaFor) {
  function read(): Saved | null {
    const row = db
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
    const { x, y, width, height, maximized } = row;
    return { x, y, width, height, maximized: maximized === 1 };
  }

  function write(state: Saved): void {
    db
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

  function restoreWindowBounds(): {
    width: number;
    height: number;
    x?: number;
    y?: number;
    maximized: boolean;
  } {
    const saved = read();
    return {
      ...fitToWorkArea(saved, workAreaFor(saved)),
      maximized: saved?.maximized ?? false,
    };
  }

  /**
   * Saves on a trailing timer because resizing fires these events continuously,
   * and on close because the last drag may not have settled yet.
   */
  function trackWindowState(window: TrackedWindow): void {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const save = () => {
      if (window.isDestroyed()) return;
      // Normal bounds, so un-maximizing lands back on a real size rather than
      // filling the screen forever. Fullscreen has no meaningful bounds to
      // record, and is deliberately not remembered: an app that reopens
      // fullscreen without being asked to is a nuisance.
      if (window.isFullScreen()) return;
      const { x, y, width, height } = window.getNormalBounds();
      write({ x, y, width, height, maximized: window.isMaximized() });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, SAVE_AFTER_MS);
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

  return { restoreWindowBounds, trackWindowState };
}

export type WindowState = ReturnType<typeof createWindowState>;
