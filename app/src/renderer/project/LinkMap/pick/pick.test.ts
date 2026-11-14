import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN, drawn, isOpen, pick } from './pick.ts';
import type { Shape } from './pick.ts';

/** Two pages: node 0 holds blocks 2 and 3, node 1 is empty. */
const SHAPE: Shape = {
  pages: 2,
  parent: Int32Array.of(-1, -1, 0, 0),
  sibStart: Uint32Array.of(0, 0, 2, 2),
  sibCount: Uint32Array.of(2, 2, 2, 2),
  childStart: Uint32Array.of(2, 4, 4, 4),
  childCount: Uint32Array.of(2, 0, 0, 0),
  radius: Float32Array.of(4, 2, 1, 1),
};
const STATE = Float32Array.of(0, 0, 0, 0, /**/ 20, 0, 0, 0, /**/ -2, 0, 0, 0, /**/ 2, 0, 0, 0);
const SIZE = { width: 400, height: 400 };

test('zoomed out, a bubble is a dot and is what is picked', () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  assert.equal(isOpen(SHAPE, camera, 0), false);
  assert.deepEqual(pick(SHAPE, STATE, camera, SIZE, 198, 200), { node: 0, ground: false });
  assert.deepEqual(pick(SHAPE, STATE, camera, SIZE, 220, 200), { node: 1, ground: false });
  assert.equal(pick(SHAPE, STATE, camera, SIZE, 300, 300), undefined);
});

test('a dot never gets too small to hit', () => {
  const camera = { x: 0, y: 0, zoom: 0.01 };
  assert.equal(drawn(SHAPE, camera, 0), 2.5);
  assert.deepEqual(pick(SHAPE, STATE, camera, SIZE, 201, 201), { node: 1, ground: false });
});

test('zoomed in, what is in an open bubble is picked before the bubble', () => {
  const camera = { x: 0, y: 0, zoom: OPEN / 4 };
  assert.equal(isOpen(SHAPE, camera, 0), true);
  const [x] = [200 + 2 * camera.zoom];
  assert.deepEqual(pick(SHAPE, STATE, camera, SIZE, x, 200), { node: 3, ground: false });
  assert.deepEqual(pick(SHAPE, STATE, camera, SIZE, 200, 200 + 3 * camera.zoom), { node: 0, ground: false });
});

test('a bubble that fills the view is ground, but for its rim', () => {
  const camera = { x: 0, y: 0, zoom: 60 };
  assert.deepEqual(pick(SHAPE, STATE, camera, SIZE, 200, 300), { node: 0, ground: true });
  assert.deepEqual(pick(SHAPE, STATE, camera, SIZE, 200, 200 + 4 * 60 - 2), { node: 0, ground: false });
});

test('with blocks off, an open bubble is picked itself, never what is in it', () => {
  const camera = { x: 0, y: 0, zoom: OPEN / 4 };
  assert.deepEqual(pick(SHAPE, STATE, camera, SIZE, 200 + 2 * camera.zoom, 200, false), { node: 0, ground: false });
  // And one that fills the view is still ground to pan by.
  assert.deepEqual(pick(SHAPE, STATE, { x: 0, y: 0, zoom: 60 }, SIZE, 200 + 2 * 60, 200, false), { node: 0, ground: true });
});
