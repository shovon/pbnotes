/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PageListing } from '@pbnotes/graph';
import { INITIAL, sorted, toggle } from './sort.ts';

const pages: PageListing[] = [
  { title: 'mira', blocks: 3, references: 1, taggedBy: 2, edited: 200 },
  { title: 'Oslo', blocks: 0, references: 4, taggedBy: 0 },
  { title: 'Atlas', blocks: 3, references: 0, taggedBy: 2, edited: 300 },
  { title: '2026-11-01', blocks: 1, references: 0, taggedBy: 5, edited: 100 },
];

const titles = (list: PageListing[]) => list.map((page) => page.title);

test('the list opens A to Z by title, ignoring case', () => {
  assert.deepEqual(titles(sorted(pages, INITIAL)), ['2026-11-01', 'Atlas', 'mira', 'Oslo']);
});

test('a count sorts most first, ties A to Z', () => {
  assert.deepEqual(titles(sorted(pages, toggle(INITIAL, 'blocks'))), ['Atlas', 'mira', '2026-11-01', 'Oslo']);
  assert.deepEqual(titles(sorted(pages, toggle(INITIAL, 'references'))), ['Oslo', 'mira', '2026-11-01', 'Atlas']);
  assert.deepEqual(titles(sorted(pages, toggle(INITIAL, 'taggedBy'))), ['2026-11-01', 'Atlas', 'mira', 'Oslo']);
});

test('times sort newest first, and a page with none goes last either way', () => {
  const newest = toggle(INITIAL, 'edited');
  assert.deepEqual(titles(sorted(pages, newest)), ['Atlas', 'mira', '2026-11-01', 'Oslo']);
  assert.deepEqual(titles(sorted(pages, toggle(newest, 'edited'))), ['2026-11-01', 'mira', 'Atlas', 'Oslo']);
});

test('the same header again turns the order round', () => {
  assert.deepEqual(toggle(INITIAL, 'title'), { by: 'title', descending: true });
  assert.deepEqual(toggle(toggle(INITIAL, 'blocks'), 'blocks'), { by: 'blocks', descending: false });
});

test('sorting leaves the list it was handed as it was', () => {
  const before = [...pages];
  sorted(pages, toggle(INITIAL, 'blocks'));
  assert.deepEqual(pages, before);
});
