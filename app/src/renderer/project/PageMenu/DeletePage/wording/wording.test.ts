/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wording } from './wording.ts';

test('with nothing pointing at it, the page and everything on it go', () => {
  assert.deepEqual(wording('Foo', { links: 0, refs: 0 }), [
    '“Foo” and everything on it will be deleted.',
  ]);
});

test('links by title say the page will stay', () => {
  assert.deepEqual(wording('Foo', { links: 3, refs: 0 }), [
    '3 blocks on other pages link to “Foo”. Its blocks and properties will be deleted, but “Foo” will still exist and show up in search until those links are removed.',
  ]);
  assert.match(wording('Foo', { links: 1, refs: 0 })[0], /^1 block on another page links to/);
});

test('block refs get a line of their own', () => {
  assert.deepEqual(wording('Foo', { links: 0, refs: 2 }), [
    '“Foo” and everything on it will be deleted.',
    '2 blocks on other pages reference blocks on “Foo”. Those references will show as missing.',
  ]);
  assert.match(wording('Foo', { links: 1, refs: 1 })[1], /^1 block on another page references blocks/);
});
