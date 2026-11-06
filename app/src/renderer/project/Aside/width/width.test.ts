/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_WIDTH, ROOM_LEFT, fit, widthAt } from './width.ts';

test('the width is how far the edge is from the right of the window', () => {
  assert.equal(widthAt(1000, 1400), 400);
});

test('it never goes narrower than the least', () => {
  assert.equal(widthAt(1350, 1400), MIN_WIDTH);
  assert.equal(widthAt(2000, 1400), MIN_WIDTH);
});

test('it always leaves room for the page', () => {
  assert.equal(widthAt(0, 1400), 1400 - ROOM_LEFT);
});

test('in a window too narrow for both, the least wins', () => {
  assert.equal(widthAt(0, 400), MIN_WIDTH);
});

test('a fraction of a pixel is rounded', () => {
  assert.equal(widthAt(999.6, 1400), 400);
});

test('a width chosen in a wide window is drawn narrower in a narrow one', () => {
  assert.equal(fit(600, 800), 800 - ROOM_LEFT);
  assert.equal(fit(600, 1400), 600);
});
