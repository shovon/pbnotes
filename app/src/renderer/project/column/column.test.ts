/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE, inColumn } from './column.ts';
import { begins, swept } from '../selection/sweep/sweep.ts';

/** The page's blocks and a card's, side by side at the same heights (#305). */
const rows = [
  { key: 'page-1', column: PAGE, top: 0, bottom: 20 },
  { key: 'page-2', column: PAGE, top: 20, bottom: 40 },
  { key: 'page-3', column: PAGE, top: 40, bottom: 60 },
  { key: 'card-1', column: 'aside', top: 10, bottom: 30 },
  { key: 'card-2', column: 'aside', top: 30, bottom: 50 },
];

test('a column holds its own rows, in order, and no other', () => {
  assert.deepEqual(inColumn(rows, 'aside').map((it) => it.key), ['card-1', 'card-2']);
  assert.deepEqual(inColumn(rows, PAGE).map((it) => it.key), ['page-1', 'page-2', 'page-3']);
});

test('a press on a card block, moved within it, does not begin a sweep (#305)', () => {
  // Over the whole tab, the page's row at that height is "another row".
  assert.equal(begins(rows, 'card-1', 25, 2), true);
  assert.equal(begins(inColumn(rows, 'aside'), 'card-1', 25, 2), false);
});

test('a sweep down a card selects its blocks, not the page beside it (#305)', () => {
  assert.deepEqual(swept(inColumn(rows, 'aside'), 20, 45), { anchor: 'card-1', head: 'card-2' });
});

test('a sweep down the page selects its blocks, not the card beside it (#305)', () => {
  assert.deepEqual(swept(inColumn(rows, PAGE), 5, 45), { anchor: 'page-1', head: 'page-3' });
});
