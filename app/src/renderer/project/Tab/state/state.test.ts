/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEW_TAB, left, renamedIn, withField } from './state.ts';
import type { TabState } from './state.ts';

const on = (page: string, aside: string[] = []): TabState => ({
  ...NEW_TAB,
  trail: [undefined, { page }],
  aside,
});

test('a new tab is on the journal, with nothing beside it', () => {
  assert.deepEqual(NEW_TAB.trail, []);
  assert.deepEqual(NEW_TAB.aside, []);
  assert.equal(NEW_TAB.target, null);
});

test('setting a field to what it holds leaves the very same tab', () => {
  const tab = on('Mira');
  assert.equal(withField(tab, 'aside', tab.aside), tab);
});

test('setting a field to something else changes that field alone', () => {
  const tab = on('Mira');
  const next = withField(tab, 'asideWidth', 400);
  assert.equal(next.asideWidth, 400);
  assert.equal(next.trail, tab.trail);
});

test('a rename reaches the trail and the aside', () => {
  const next = renamedIn(on('Mira', ['mira', 'Bar']), 'Mira', 'Vera');
  assert.deepEqual(next.trail, [undefined, { page: 'Vera' }]);
  assert.deepEqual(next.aside, ['Vera', 'Bar']);
});

test('a rename of a page the tab does not hold leaves the very same tab', () => {
  const tab = on('Mira', ['Bar']);
  assert.equal(renamedIn(tab, 'Baz', 'Qux'), tab);
});

test('a page deleted steps the tab off it', () => {
  assert.deepEqual(left(on('Mira'), 'mira').trail, []);
});

test('a page deleted that the tab is not on leaves the very same tab', () => {
  const tab = on('Mira');
  assert.equal(left(tab, 'Bar'), tab);
});
