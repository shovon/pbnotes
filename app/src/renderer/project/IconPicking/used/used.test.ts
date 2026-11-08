/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEPT, used } from './used.ts';

test('the emoji just used goes first, once', () => {
  assert.deepEqual(used([], '🌲'), ['🌲']);
  assert.deepEqual(used(['📚', '🌲', '🚀'], '🌲'), ['🌲', '📚', '🚀']);
  assert.deepEqual(used(['📚'], '🚀'), ['🚀', '📚']);
});

test('the oldest falls off past KEPT', () => {
  const full = Array.from({ length: KEPT }, (_, at) => String.fromCodePoint(0x1f600 + at));
  const next = used(full, '🌲');
  assert.equal(next.length, KEPT);
  assert.equal(next[0], '🌲');
  assert.equal(next.at(-1), full.at(-2));
});
