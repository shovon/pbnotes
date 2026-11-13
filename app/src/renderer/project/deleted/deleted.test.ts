/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Place } from '../../../shared/graph.ts';
import type { Held } from '../held/held.ts';
import { deletedSince } from './deleted.ts';

const at = (place: Place | undefined, deletions: number, title = place?.page ?? 'today'): Held => ({
  place,
  view: {
    version: 1,
    showing: [{ page: { title, blocks: [] }, references: [], links: 0, properties: [], tags: [], aliases: [], taggedBy: [], deletions, refsTo: 0 }],
    previews: [],
  },
});

test('the count going up on the same page is a delete, named as the page shows', () => {
  assert.equal(deletedSince(at({ page: 'foo' }, 0, 'Foo'), at({ page: 'foo' }, 1, 'Foo')), 'Foo');
});

test('a zoom into the page counts as being on it', () => {
  const before = at({ page: 'Foo', block: 'b1' }, 2);
  assert.equal(deletedSince(before, at({ page: 'Foo' }, 3)), 'Foo');
});

test('the same count, or a first answer, is no delete', () => {
  assert.equal(deletedSince(at({ page: 'Foo' }, 1), at({ page: 'Foo' }, 1)), undefined);
  assert.equal(deletedSince(null, at({ page: 'Foo' }, 4)), undefined);
});

test('arriving from another place is no delete, whatever the count', () => {
  assert.equal(deletedSince(at({ page: 'Bar' }, 0), at({ page: 'Foo' }, 3)), undefined);
  assert.equal(deletedSince(at(undefined, 0), at({ page: 'Foo' }, 3)), undefined);
});

test('the journal never reports a delete', () => {
  assert.equal(deletedSince(at(undefined, 0), at(undefined, 1)), undefined);
});
