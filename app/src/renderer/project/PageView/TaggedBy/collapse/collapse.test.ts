/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapse, LIMIT } from './collapse.ts';

const pages = (n: number) => Array.from({ length: n }, (_, i) => `Page ${i + 1}`);

test('a list within the limit shows whole, with nothing hidden', () => {
  assert.deepEqual(collapse(pages(3), false), { shown: pages(3), hidden: 0 });
  assert.deepEqual(collapse(pages(LIMIT), false), { shown: pages(LIMIT), hidden: 0 });
});

test('past the limit, the first ones show and the rest are counted', () => {
  const { shown, hidden } = collapse(pages(LIMIT + 5), false);
  assert.deepEqual(shown, pages(LIMIT));
  assert.equal(hidden, 5);
});

test('expanded, everything shows', () => {
  assert.deepEqual(collapse(pages(LIMIT + 5), true), { shown: pages(LIMIT + 5), hidden: 0 });
});

test('an empty list is empty', () => {
  assert.deepEqual(collapse([], false), { shown: [], hidden: 0 });
});
