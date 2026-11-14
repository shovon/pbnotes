import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groups } from './groups.ts';

/** Nodes 0 and 1 are days, 2 to 4 are pages, 5 is a block: every one of radius 2. */
const FLAT = { pages: 5, day: Uint8Array.of(1, 1, 0, 0, 0, 0), radius: Float32Array.of(2, 2, 2, 2, 2, 2) };
const at = (...points: [number, number][]) => Float32Array.from(points.flatMap(([x, y]) => [x, y, 0, 0]));

test('the days are drawn to their own middle', () => {
  const it = groups(FLAT, at([10, 0], [14, 4], [0, 0], [0, 0], [0, 0], [99, 99]));
  assert.deepEqual(it.days, { x: 12, y: 2 });
});

test('clusters on top of each other are pushed apart, the days to the right', () => {
  const it = groups(FLAT, at([0, 1], [0, -1], [1, 0], [-1, 0], [0, 0], [99, 99]));
  assert.ok(it.apart.x > 0);
  assert.equal(it.apart.y, 0);
  // Two days against three pages: the pages take two fifths of it.
  assert.equal(it.share, 2 / 5);
});

test('clusters that overlap are pushed apart along the line between them, and ones far apart drawn back', () => {
  const near = groups(FLAT, at([0, 9], [0, 11], [1, 0], [-1, 0], [0, 0], [99, 99]));
  assert.ok(near.apart.y > 0);
  assert.ok(Math.abs(near.apart.x) < 1e-9);
  const far = groups(FLAT, at([0, 99], [0, 101], [1, 0], [-1, 0], [0, 0], [99, 99]));
  assert.ok(far.apart.y < 0);
  // Somewhere between the two they are left where they are.
  const held = groups(FLAT, at([0, 65], [0, 67], [1, 0], [-1, 0], [0, 0], [99, 99]));
  assert.ok(Math.abs(held.apart.y) < 0.01, String(held.apart.y));
});

test('with no days, or nothing but days, nothing is pushed', () => {
  const none = groups({ ...FLAT, day: new Uint8Array(6) }, at([0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]));
  assert.deepEqual(none.apart, { x: 0, y: 0 });
  const only = groups({ pages: 2, day: Uint8Array.of(1, 1), radius: Float32Array.of(2, 2) }, at([0, 0], [4, 0]));
  assert.deepEqual([only.days, only.apart, only.share], [{ x: 2, y: 0 }, { x: 0, y: 0 }, 0]);
});
