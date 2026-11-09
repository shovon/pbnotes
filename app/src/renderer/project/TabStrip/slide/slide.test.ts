/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftOf, slideTo } from './slide.ts';

/** Four tabs 100 wide, edge to edge from 0. */
const four = [0, 100, 200, 300].map((left) => ({ left, width: 100 }));

test('a tab not moved, or moved short of a neighbour’s middle, stays where it is', () => {
  assert.equal(slideTo(four, 1, 0), 1);
  assert.equal(slideTo(four, 1, 49), 1);
  assert.equal(slideTo(four, 1, -49), 1);
});

test('its leading edge past a neighbour’s middle, it takes that neighbour’s place', () => {
  assert.equal(slideTo(four, 1, 51), 2);
  assert.equal(slideTo(four, 1, -51), 0);
});

test('far along it passes several, and stops at either end', () => {
  assert.equal(slideTo(four, 0, 260), 3);
  assert.equal(slideTo(four, 0, 5000), 3);
  assert.equal(slideTo(four, 3, -5000), 0);
});

test('tabs of different widths are passed by their own middles', () => {
  const boxes = [
    { left: 0, width: 100 },
    { left: 100, width: 40 },
    { left: 140, width: 200 },
  ];
  // Its right edge at 100 + 21 = 121: past the narrow tab's middle (120), not the wide one's (240).
  assert.equal(slideTo(boxes, 0, 21), 1);
  assert.equal(slideTo(boxes, 0, 19), 0);
  assert.equal(slideTo(boxes, 0, 141), 2);
});

test('a dragged tab from nowhere stays nowhere', () => {
  assert.equal(slideTo(four, 7, 300), 7);
});

test('dragged right, the tabs it has passed slide left by its width, and no others', () => {
  assert.deepEqual([0, 1, 2, 3].map((at) => shiftOf(at, 0, 2, 100)), [0, -100, -100, 0]);
});

test('dragged left, the tabs it has passed slide right by its width, and no others', () => {
  assert.deepEqual([0, 1, 2, 3].map((at) => shiftOf(at, 3, 1, 100)), [0, 100, 100, 0]);
});

test('not moved, nothing slides', () => {
  assert.deepEqual([0, 1, 2, 3].map((at) => shiftOf(at, 2, 2, 100)), [0, 0, 0, 0]);
});
