/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Place } from '../../../shared/graph.ts';
import type { Held } from '../held/held.ts';
import { renamedSince } from './renamed.ts';

const at = (place: Place | undefined, title: string): Held => ({
  place,
  view: {
    version: 1,
    showing: [{ page: { title, blocks: [] }, references: [], links: 0, properties: [], tags: [], taggedBy: [], deletions: 0, refsTo: 0 }],
    previews: [],
  },
});

test('the page coming back under a new title is a rename, from and to as they show', () => {
  assert.deepEqual(renamedSince(at({ page: 'mira' }, 'Mira'), at({ page: 'mira' }, 'Mira Sato')), {
    from: 'Mira',
    to: 'Mira Sato',
  });
});

test('a case-only rename is one too', () => {
  assert.deepEqual(renamedSince(at({ page: 'Mira' }, 'mira'), at({ page: 'Mira' }, 'Mira')), {
    from: 'mira',
    to: 'Mira',
  });
});

test('a zoom into the page counts as being on it', () => {
  assert.deepEqual(renamedSince(at({ page: 'Mira', block: 'b1' }, 'Mira'), at({ page: 'Mira' }, 'Sato')), {
    from: 'Mira',
    to: 'Sato',
  });
});

test('a date name is on its day', () => {
  const day = { page: 'Nov 6th, 2026' };
  assert.deepEqual(renamedSince(at(day, '2026-11-06'), at(day, 'Trip')), { from: '2026-11-06', to: 'Trip' });
});

test('the same title, or a first answer, is no rename', () => {
  assert.equal(renamedSince(at({ page: 'Mira' }, 'Mira'), at({ page: 'Mira' }, 'Mira')), undefined);
  assert.equal(renamedSince(null, at({ page: 'Mira' }, 'Sato')), undefined);
});

test('arriving from another place is no rename', () => {
  assert.equal(renamedSince(at({ page: 'Bar' }, 'Bar'), at({ page: 'Mira' }, 'Sato')), undefined);
  assert.equal(renamedSince(at(undefined, 'today'), at({ page: 'Mira' }, 'Sato')), undefined);
});

test("an alias going away is no rename: the window was not on the alias's own page", () => {
  assert.equal(renamedSince(at({ page: 'JS' }, 'JavaScript'), at({ page: 'JS' }, 'JS')), undefined);
});

test('the journal never reports a rename', () => {
  assert.equal(renamedSince(at(undefined, '2026-11-06'), at(undefined, 'Trip')), undefined);
});
