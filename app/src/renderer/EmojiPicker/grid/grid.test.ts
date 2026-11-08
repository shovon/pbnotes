/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { move, rowsOf } from './grid.ts';

/*
 * Two sections, 3 to a row:
 *   0 1 2
 *   3 4        (the first section ends)
 *   5 6 7
 *   8
 */
const ROWS = rowsOf([5, 4], 3);

test('each section starts a row, and its last row can be short', () => {
  assert.deepEqual(ROWS, [
    { start: 0, length: 3 },
    { start: 3, length: 2 },
    { start: 5, length: 3 },
    { start: 8, length: 1 },
  ]);
  assert.deepEqual(rowsOf([0, 2], 3), [{ start: 0, length: 2 }], 'an empty section has no row');
});

test('left and right go along the order, across rows, and stop at the ends', () => {
  assert.equal(move(ROWS, 2, 'ArrowRight'), 3);
  assert.equal(move(ROWS, 5, 'ArrowLeft'), 4);
  assert.equal(move(ROWS, 0, 'ArrowLeft'), 0);
  assert.equal(move(ROWS, 8, 'ArrowRight'), 8);
});

test('up and down keep the column, or land on the last cell of a shorter row', () => {
  assert.equal(move(ROWS, 1, 'ArrowDown'), 4);
  assert.equal(move(ROWS, 2, 'ArrowDown'), 4, 'the short row');
  assert.equal(move(ROWS, 4, 'ArrowDown'), 6, 'into the next section');
  assert.equal(move(ROWS, 7, 'ArrowDown'), 8);
  assert.equal(move(ROWS, 6, 'ArrowUp'), 4);
  assert.equal(move(ROWS, 8, 'ArrowUp'), 5);
});

test('up from the top row and down from the bottom stay put', () => {
  assert.equal(move(ROWS, 1, 'ArrowUp'), 1);
  assert.equal(move(ROWS, 8, 'ArrowDown'), 8);
});

test('an index past the end is pulled in, and an empty grid stays at 0', () => {
  assert.equal(move(ROWS, 40, 'ArrowLeft'), 7);
  assert.equal(move([], 3, 'ArrowDown'), 0);
});
