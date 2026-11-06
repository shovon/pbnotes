/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelve, unshelve } from './stack.ts';

test('the first page opened makes a stack of one', () => {
  assert.deepEqual(shelve([], 'Mira'), ['Mira']);
});

test('a page opened goes on top', () => {
  assert.deepEqual(shelve(['Bar', 'Baz'], 'Mira'), ['Mira', 'Bar', 'Baz']);
});

test('a page opened again moves to the top, once', () => {
  assert.deepEqual(shelve(['Bar', 'Mira', 'Baz'], 'Mira'), ['Mira', 'Bar', 'Baz']);
});

test('a page already on top leaves the very same stack', () => {
  const stack = ['Mira', 'Bar'];
  assert.equal(shelve(stack, 'mira'), stack);
});

test('pages that canonicalize alike are one card, in the spelling it was opened with', () => {
  assert.deepEqual(shelve(['Bar', 'mira'], 'Mira'), ['mira', 'Bar']);
});

test('there is no limit', () => {
  const many = Array.from({ length: 500 }, (_, i) => `p${i}`);
  assert.equal(many.reduce<string[]>(shelve, []).length, 500);
});

test('closing a card takes it off the stack, by canonical title', () => {
  assert.deepEqual(unshelve(['Mira', 'Bar', 'Baz'], 'bar'), ['Mira', 'Baz']);
});

test('closing a page not on the stack leaves the very same stack', () => {
  const stack = ['Mira'];
  assert.equal(unshelve(stack, 'Bar'), stack);
});
