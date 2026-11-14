import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LinkMap, Sub } from '@pbnotes/graph/link-map';
import { DAY_LINE, DAY_STRENGTH, KINDS, PULL, SPRING, flatten, place } from './flat.ts';

/** Mira: m1 (m2 under it), m3. Oslo: o1. Book: nothing. */
const MAP: LinkMap = {
  pages: [
    { title: 'Book', blocks: 0, forest: [] },
    {
      title: 'Mira',
      blocks: 3,
      forest: [
        { id: 'm1', children: [{ id: 'm2', children: [] }] },
        { id: 'm3', children: [] },
      ],
    },
    { title: 'Oslo', blocks: 1, forest: [{ id: 'o1', children: [] }] },
  ],
  edges: [
    { from: { page: 'Mira', block: 'm1' }, to: { page: 'Oslo' }, kind: 'link' },
    { from: { page: 'Mira', block: 'm2' }, to: { page: 'Oslo', block: 'o1' }, kind: 'ref' },
    { from: { page: 'Book' }, to: { page: 'Oslo' }, kind: 'tag' },
    // Into the bubble it starts in: nowhere to draw it.
    { from: { page: 'Mira', block: 'm3' }, to: { page: 'Mira' }, kind: 'link' },
    { from: { page: 'Mira', block: 'm3' }, to: { page: 'Mira', block: 'm1' }, kind: 'ref' },
  ],
};

test('flatten: pages first, then each bubble’s children as one run', () => {
  const flat = flatten(MAP);
  assert.deepEqual(flat.ids, ['p:Book', 'p:Mira', 'p:Oslo', 'b:m1', 'b:m3', 'b:o1', 'b:m2']);
  assert.equal(flat.pages, 3);
  assert.deepEqual([...flat.parent], [-1, -1, -1, 1, 1, 2, 3]);
  assert.deepEqual([...flat.depth], [0, 0, 0, 1, 1, 1, 2]);
  // Mira's children are nodes 3 and 4, and each is the other's sibling.
  assert.deepEqual([flat.childStart[1], flat.childCount[1]], [3, 2]);
  assert.deepEqual([flat.sibStart[4], flat.sibCount[4]], [3, 2]);
  assert.deepEqual([flat.sibStart[0], flat.sibCount[0]], [0, 3]);
  assert.deepEqual(flat.titles, ['Book', 'Mira', 'Oslo', 'Mira', 'Mira', 'Oslo', 'Mira']);
  assert.equal(flat.blocks[6], 'm2');
});

test('flatten: a bubble is bigger than what it holds, and an empty page than a block', () => {
  const { radius } = flatten(MAP);
  assert.ok(radius[0] > radius[6]);
  assert.ok(radius[3] > radius[6]);
  assert.ok(radius[1] > radius[3] + radius[4]);
});

test('flatten: arrows keep their ends; one into its own bubble is dropped', () => {
  const { edges } = flatten(MAP);
  assert.deepEqual([...edges], [
    3, 2, KINDS.link, 0,
    6, 5, KINDS.ref, 0,
    0, 2, KINDS.tag, 0,
    4, 3, KINDS.ref, 0,
  ]);
});

test('flatten: a spring joins the siblings the two ends are under, and a block is pulled toward its target', () => {
  const flat = flatten(MAP);
  const of = (node: number) => {
    const out: number[][] = [];
    for (let k = 0; k < flat.springCount[node]; k++) {
      out.push([...flat.springs.subarray((flat.springStart[node] + k) * 4, (flat.springStart[node] + k) * 4 + 2)]);
    }
    return out;
  };
  // Mira and Oslo, once for both arrows; Book and Oslo.
  assert.deepEqual(of(1), [[2, SPRING]]);
  assert.deepEqual(of(2), [[1, SPRING], [0, SPRING]]);
  // m1 toward Oslo, m2 toward o1 and back; m3 and m1 are siblings, so a spring.
  assert.deepEqual(of(3), [[4, SPRING], [2, PULL]]);
  assert.deepEqual(of(6), [[5, PULL]]);
  assert.deepEqual(of(5), [[6, PULL]]);
});

test('place: kept places are kept, and a new block starts inside its bubble', () => {
  const flat = flatten(MAP);
  const state = place(flat, new Map([['p:Mira', [100, 50]]]));
  assert.deepEqual([state[4], state[5]], [100, 50]);
  for (const child of [3, 4]) {
    assert.ok(Math.hypot(state[child * 4] - 100, state[child * 4 + 1] - 50) < flat.radius[1]);
  }
  // Nothing starts on top of anything else.
  const at = new Set(Array.from({ length: flat.count }, (_, i) => `${state[i * 4]},${state[i * 4 + 1]}`));
  assert.equal(at.size, flat.count);
});

test('flatten: each journal day is sprung to the next there is, weaker across a gap', () => {
  const day = (title: string): LinkMap['pages'][number] => ({ title, blocks: 0, forest: [] });
  // Listed out of order, with a page among them, as a map may have them.
  const flat = flatten({
    pages: [day('2026-11-13'), day('Mira'), day('2026-11-09'), day('2026-11-12'), day('2026-13-45')],
    edges: [],
  });
  const of = (node: number) =>
    Array.from({ length: flat.springCount[node] }, (_, k) => {
      const at = (flat.springStart[node] + k) * 4;
      return [flat.springs[at], flat.springs[at + 1], flat.springs[at + 2]];
    });
  // The 9th to the 12th, three days on; the 12th to the 13th, the day after.
  assert.deepEqual(of(2), [[3, SPRING, Math.fround(DAY_STRENGTH / Math.sqrt(3))]]);
  assert.deepEqual(of(3), [[2, SPRING, Math.fround(DAY_STRENGTH / Math.sqrt(3))], [0, SPRING, DAY_STRENGTH]]);
  assert.deepEqual(of(0), [[3, SPRING, DAY_STRENGTH]]);
  assert.deepEqual([...flat.day], [1, 0, 1, 1, 0]);
  // And a line is drawn along it, in date order.
  assert.deepEqual([...flat.edges], [2, 3, DAY_LINE, 0, 3, 0, DAY_LINE, 0]);
  // A page, and a title that only looks like a date, are left out of it.
  assert.deepEqual(of(1), []);
  assert.deepEqual(of(4), []);
});

test('place: the journal\'s days start together, to the right of the other pages', () => {
  const page = (title: string): LinkMap['pages'][number] => ({ title, blocks: 0, forest: [] });
  const flat = flatten({
    pages: [page('2026-11-12'), page('Mira'), page('2026-11-13'), page('Oslo'), page('Book')],
    edges: [],
  });
  const state = place(flat);
  const x = (node: number) => state[node * 4];
  assert.ok(Math.min(x(0), x(2)) > Math.max(x(1), x(3), x(4)));
});

test('flatten: with its blocks not showing a page is a speck, and grows in a straight line with the arrows that point at it', () => {
  const { radius, compact } = flatten(MAP);
  // Nothing points at Book. Mira's only arrows are its own, into itself, which count for nothing.
  assert.equal(compact[0], Math.fround(0.6));
  assert.equal(compact[1], Math.fround(0.6));
  // Three point at Oslo: a link, a ref to a block on it, and a tag.
  assert.equal(compact[2], Math.fround(0.6 + 3 * 0.15));
  // Each arrow adds as much as the last.
  const page = (title: string, ...ids: string[]): LinkMap['pages'][number] => ({
    title,
    blocks: ids.length,
    forest: ids.map((id): Sub => ({ id, children: [] })),
  });
  const pointing = (count: number) =>
    flatten({
      pages: [page('Hub'), page('Spoke', ...Array.from({ length: count }, (_, i) => `s${i}`))],
      edges: Array.from({ length: count }, (_, i) => ({ from: { page: 'Spoke', block: `s${i}` }, to: { page: 'Hub' }, kind: 'link' as const })),
    }).compact[0];
  assert.ok(Math.abs(pointing(20) - pointing(10) - (pointing(10) - pointing(0))) < 1e-5);
  // A block is the size it is.
  assert.equal(compact[3], radius[3]);
});
