/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitOf, marked, rows, step } from './results.ts';

test('pages come before blocks, and each opens what it names', () => {
  const list = rows({
    pages: ['Mira'],
    blocks: [{ id: 'b1', page: '2026-10-12', text: 'Call Mira' }],
  });
  assert.deepEqual(
    list.map((row) => row.kind),
    ['page', 'block'],
  );
  assert.deepEqual(list.map(hitOf), [{ page: 'Mira' }, { block: 'b1' }]);
});

test('stepping wraps at both ends and stays put in an empty list', () => {
  assert.equal(step(2, 1, 3), 0);
  assert.equal(step(0, -1, 3), 2);
  assert.equal(step(0, 1, 0), 0);
});

test('every match is marked, ignoring case', () => {
  assert.deepEqual(marked('Mira and mira', 'MIRA'), [
    { text: 'Mira', match: true },
    { text: ' and ', match: false },
    { text: 'mira', match: true },
  ]);
});

test('a blank query, or text whose length lowering changes, is left whole', () => {
  assert.deepEqual(marked('Mira', '  '), [{ text: 'Mira', match: false }]);
  assert.deepEqual(marked('İstanbul', 'i'), [{ text: 'İstanbul', match: false }]);
});
