/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opensFinder } from './shortcut.ts';

const press = (
  key: string,
  held: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>>,
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...held,
});

test('Cmd+K on a Mac and Ctrl+K elsewhere, in either case', () => {
  assert.equal(opensFinder(press('k', { metaKey: true }), true), true);
  assert.equal(opensFinder(press('K', { metaKey: true }), true), true);
  assert.equal(opensFinder(press('k', { ctrlKey: true }), false), true);
});

test("the other platform's modifier, an extra modifier, or another key is not it", () => {
  assert.equal(opensFinder(press('k', { ctrlKey: true }), true), false);
  assert.equal(opensFinder(press('k', { metaKey: true }), false), false);
  assert.equal(opensFinder(press('k', { metaKey: true, shiftKey: true }), true), false);
  assert.equal(opensFinder(press('k', { metaKey: true, ctrlKey: true }), true), false);
  assert.equal(opensFinder(press('j', { metaKey: true }), true), false);
  assert.equal(opensFinder(press('k', {}), true), false);
});
