/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SIZE, MIN_SIZE, fitToWorkArea } from "./window-bounds.ts";

const screen = { x: 0, y: 0, width: 1920, height: 1080 };

test("a rectangle already on screen is kept as it was", () => {
  const saved = { x: 100, y: 80, width: 1200, height: 800 };
  assert.deepEqual(fitToWorkArea(saved, screen), {
    x: 100,
    y: 80,
    width: 1200,
    height: 800,
  });
});

test("a position on a display that is gone is dropped, size kept", () => {
  // Second monitor was to the left; now there is only the built-in one.
  const saved = { x: -1800, y: 40, width: 1000, height: 700 };
  assert.deepEqual(fitToWorkArea(saved, screen), {
    width: 1000,
    height: 700,
  });
});

test("a sliver still overlapping counts as on screen", () => {
  const saved = { x: 1900, y: 0, width: 1000, height: 700 };
  assert.equal(fitToWorkArea(saved, screen).x, 1900);
});

test("size is clamped to the minimum and to the display", () => {
  const tiny = fitToWorkArea({ x: 0, y: 0, width: 200, height: 100 }, screen);
  assert.deepEqual(
    { width: tiny.width, height: tiny.height },
    { width: MIN_SIZE.width, height: MIN_SIZE.height },
  );

  const huge = fitToWorkArea(
    { x: 0, y: 0, width: 4000, height: 3000 },
    { x: 0, y: 0, width: 1440, height: 900 },
  );
  assert.deepEqual(
    { width: huge.width, height: huge.height },
    { width: 1440, height: 900 },
  );
});

test("a first launch takes the default size, clamped to a small panel", () => {
  assert.deepEqual(fitToWorkArea(null, screen), DEFAULT_SIZE);
  assert.deepEqual(
    fitToWorkArea(null, { x: 0, y: 0, width: 1366, height: 728 }),
    {
      width: 1200,
      height: 728,
    },
  );
});
