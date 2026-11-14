import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LinkMap, Sub } from '@pbnotes/graph/link-map';
import { withoutDays } from './days.ts';

const page = (title: string, ...ids: string[]): LinkMap['pages'][number] => ({
  title,
  blocks: ids.length,
  forest: ids.map((id): Sub => ({ id, children: [] })),
});

test('withoutDays: no day\'s page, and no arrow that starts or ends on one', () => {
  const map = {
    version: 7,
    pages: [page('2026-11-13', 'd1'), page('Mira', 'm1'), page('Oslo', 'o1')],
    edges: [
      { from: { page: '2026-11-13', block: 'd1' }, to: { page: 'Mira' }, kind: 'link' },
      { from: { page: 'Mira', block: 'm1' }, to: { page: '2026-11-13', block: 'd1' }, kind: 'ref' },
      { from: { page: 'Mira', block: 'm1' }, to: { page: 'Oslo' }, kind: 'link' },
      { from: { page: 'Oslo' }, to: { page: '2026-11-13' }, kind: 'tag' },
    ],
  } satisfies LinkMap & { version: number };
  const left = withoutDays(map);
  assert.deepEqual(left.pages.map((it) => it.title), ['Mira', 'Oslo']);
  assert.deepEqual(left.edges, [{ from: { page: 'Mira', block: 'm1' }, to: { page: 'Oslo' }, kind: 'link' }]);
  // What else it carries is kept, and the map handed in is not changed.
  assert.equal(left.version, 7);
  assert.equal(map.pages.length, 3);
});
