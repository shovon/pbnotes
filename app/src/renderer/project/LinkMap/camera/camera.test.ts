import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ZOOM, ease, fit, panBy, toScreen, toWorld, zoomAt } from './camera.ts';

const SIZE = { width: 800, height: 600 };
const near = (a: number[], b: number[]) => a.forEach((it, i) => assert.ok(Math.abs(it - b[i]) < 1e-9, `${a} ≠ ${b}`));

test('a world point goes to the screen and back', () => {
  const camera = { x: 10, y: -5, zoom: 3 };
  near(toScreen(camera, SIZE, 10, -5), [400, 300]);
  near(toWorld(camera, SIZE, ...toScreen(camera, SIZE, 42, 7)), [42, 7]);
});

test('a pinch keeps what is under the pointer under it', () => {
  const camera = { x: 10, y: -5, zoom: 3 };
  const under = toWorld(camera, SIZE, 650, 120);
  const zoomed = zoomAt(camera, SIZE, 650, 120, 1.7);
  assert.equal(zoomed.zoom, 3 * 1.7);
  near(toScreen(zoomed, SIZE, ...under), [650, 120]);
  assert.equal(zoomAt(camera, SIZE, 0, 0, 1e9).zoom, MAX_ZOOM);
});

test('a pan moves what shows with the pointer', () => {
  const camera = { x: 0, y: 0, zoom: 2 };
  near(toScreen(panBy(camera, 30, -10), SIZE, 0, 0), [430, 290]);
});

test('fit shows the whole box', () => {
  const camera = fit({ left: -100, top: -50, right: 300, bottom: 50 }, SIZE, 50);
  near([camera.x, camera.y], [100, 0]);
  assert.equal(camera.zoom, 700 / 400);
  assert.ok(toScreen(camera, SIZE, -100, -50)[0] >= 50 - 1e-9);
});

test('ease lands on its target', () => {
  near(Object.values(ease({ x: 0, y: 0, zoom: 1 }, { x: 8, y: 4, zoom: 4 }, 1)), [8, 4, 4]);
  assert.equal(ease({ x: 0, y: 0, zoom: 1 }, { x: 8, y: 4, zoom: 4 }, 0.5).zoom, 2);
});
