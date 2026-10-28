/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../db.ts";
import type { Rect } from "./window-bounds/window-bounds.ts";
import { createWindowState } from "./window-state.ts";

// Composition root for these tests: an in-memory database, displays that say
// one work area and record what they were asked, and a window that is only
// what a test sets and the events it fires. Timers are node:test's mock ones,
// so a debounce runs in no time.

const SCREEN: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

function displays() {
  const asked: (Rect | null)[] = [];
  return {
    asked,
    workAreaFor: (saved: Rect | null): Rect => {
      // The rectangle only: it may carry more, as a saved row does.
      asked.push(
        saved && {
          x: saved.x,
          y: saved.y,
          width: saved.width,
          height: saved.height,
        },
      );
      return SCREEN;
    },
  };
}

function fakeWindow() {
  const listeners = new Map<string, (() => void)[]>();
  const window = {
    destroyed: false,
    fullScreen: false,
    maximized: false,
    normal: { x: 100, y: 80, width: 1000, height: 700 } as Rect,
    on(event: string, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return window;
    },
    isDestroyed: () => window.destroyed,
    isFullScreen: () => window.fullScreen,
    isMaximized: () => window.maximized,
    getNormalBounds: () => window.normal,
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
  return window;
}

test("with nothing saved, the default size on the primary display", () => {
  const screen = displays();
  const state = createWindowState(openDatabase(":memory:"), screen.workAreaFor);
  assert.deepEqual(state.restoreWindowBounds(), {
    width: 1200,
    height: 800,
    maximized: false,
  });
  assert.deepEqual(screen.asked, [null]);
});

test("a window comes back where it was, maximized and all, on the display it was on", () => {
  const db = openDatabase(":memory:");
  const window = fakeWindow();
  createWindowState(db, displays().workAreaFor).trackWindowState(window);
  window.maximized = true;
  window.emit("close");

  // A later launch over the same database.
  const screen = displays();
  assert.deepEqual(createWindowState(db, screen.workAreaFor).restoreWindowBounds(), {
    x: 100,
    y: 80,
    width: 1000,
    height: 700,
    maximized: true,
  });
  assert.deepEqual(screen.asked, [{ x: 100, y: 80, width: 1000, height: 700 }]);
});

test("a run of moves and resizes is saved once it settles", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const db = openDatabase(":memory:");
  const state = createWindowState(db, displays().workAreaFor);
  const window = fakeWindow();
  state.trackWindowState(window);

  window.emit("resize");
  t.mock.timers.tick(300);
  window.normal = { x: 200, y: 90, width: 1100, height: 750 };
  window.emit("move");
  t.mock.timers.tick(399);
  // Still moving: nothing saved, so a launch now would get the default.
  assert.equal(state.restoreWindowBounds().x, undefined);

  t.mock.timers.tick(1);
  assert.deepEqual(state.restoreWindowBounds(), {
    x: 200,
    y: 90,
    width: 1100,
    height: 750,
    maximized: false,
  });
});

test("close saves at once, even with a save still waiting, and the waiting one never runs", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const db = openDatabase(":memory:");
  const state = createWindowState(db, displays().workAreaFor);
  const window = fakeWindow();
  state.trackWindowState(window);

  window.emit("move");
  window.normal = { x: 300, y: 100, width: 900, height: 600 };
  window.emit("close");
  assert.equal(state.restoreWindowBounds().x, 300);

  // Whatever the window says after it closed is not what it was.
  window.normal = { x: 5, y: 5, width: 900, height: 600 };
  t.mock.timers.tick(400);
  assert.equal(state.restoreWindowBounds().x, 300);
});

test("fullscreen is never saved, and neither is a window already gone", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const db = openDatabase(":memory:");
  const state = createWindowState(db, displays().workAreaFor);

  const full = fakeWindow();
  state.trackWindowState(full);
  full.fullScreen = true;
  full.emit("close");

  const gone = fakeWindow();
  state.trackWindowState(gone);
  gone.emit("resize");
  gone.destroyed = true;
  t.mock.timers.tick(400);

  assert.equal(state.restoreWindowBounds().x, undefined);
});
