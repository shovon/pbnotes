import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_LINE, KINDS } from '../flat/flat.ts';
import { cells, homes, ranked } from './grid.ts';

/** Pages 0 to 3; node 4 is a block on page 2, node 5 a block on page 3. */
const parent = Int32Array.of(-1, -1, -1, -1, 2, 3);
const flat = (...edges: number[][]) => ({ pages: 4, parent, edges: Uint32Array.from(edges.flat()) });

test('ranked: most linked first, counting arrows in and out, from blocks too', () => {
  const order = ranked(
    flat(
      [4, 1, KINDS.link, 0], // page 2's block to page 1
      [5, 4, KINDS.ref, 0], // page 3's block to page 2's block
      [0, 2, KINDS.tag, 0], // page 0 to page 2
    ),
  );
  // Page 2 is touched three times; 0, 1 and 3 once each, and stay in the map's order.
  assert.deepEqual(order, [2, 0, 1, 3]);
});

test('ranked: an arrow within a page, and the journal\'s line, count for nothing', () => {
  assert.deepEqual(ranked(flat([4, 2, KINDS.ref, 0], [0, 1, DAY_LINE, 0], [3, 1, KINDS.link, 0])), [1, 3, 0, 2]);
});

test('cells: from the corner, diagonal by diagonal, each beside the one before', () => {
  assert.deepEqual(cells(9, 3), [
    [0, 0],
    [1, 0], [0, 1],
    [0, 2], [1, 1], [2, 0],
    [2, 1], [1, 2],
    [2, 2],
  ]);
  const all = cells(40, 7);
  assert.equal(new Set(all.map(([c, r]) => `${c},${r}`)).size, 40);
  for (let i = 1; i < all.length; i++) {
    assert.ok(Math.abs(all[i][0] - all[i - 1][0]) <= 1 && Math.abs(all[i][1] - all[i - 1][1]) <= 1, `at ${i}`);
    // Never nearer the corner than the one before.
    assert.ok(all[i][0] + all[i][1] >= all[i - 1][0] + all[i - 1][1]);
  }
  // A grid not full leaves its far corner empty.
  assert.deepEqual(cells(5, 3), [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0]]);
});

test('homes: the most linked top left, the least bottom right, cells big enough for the biggest page', () => {
  const at = homes(flat([4, 1, KINDS.link, 0], [5, 4, KINDS.ref, 0], [0, 2, KINDS.tag, 0]), Float32Array.of(1, 5, 2, 1), 1);
  const of = (page: number) => [at[page * 2], at[page * 2 + 1]];
  // Two by two, 13 apart: 2 × the biggest radius, and the gap.
  assert.deepEqual(of(2), [-6.5, -6.5]);
  assert.deepEqual(of(0), [6.5, -6.5]);
  assert.deepEqual(of(1), [-6.5, 6.5]);
  assert.deepEqual(of(3), [6.5, 6.5]);
  // A wide view makes a wide grid.
  const wide = homes(flat(), Float32Array.of(1, 1, 1, 1), 4);
  assert.deepEqual([...new Set(Array.from({ length: 4 }, (_, i) => wide[i * 2 + 1]))], [0]);
  assert.equal(homes({ pages: 0, parent: new Int32Array(0), edges: new Uint32Array(0) }, new Float32Array(0), 1).length, 0);
});

test('ranked: by the arrows that point at a page, or by those that leave it', () => {
  const map = flat(
    [4, 1, KINDS.link, 0], // page 2's block to page 1
    [5, 1, KINDS.link, 0], // page 3's block to page 1
    [5, 4, KINDS.ref, 0], // page 3's block to page 2's block
    [0, 3, KINDS.tag, 0], // page 0 to page 3
  );
  // In: page 1 twice, pages 2 and 3 once, page 0 never.
  assert.deepEqual(ranked(map, 'in'), [1, 2, 3, 0]);
  // Out: page 3 twice, pages 0 and 2 once, page 1 never.
  assert.deepEqual(ranked(map, 'out'), [3, 0, 2, 1]);
  // Both: page 3 three times, then 1 and 2 twice, then 0.
  assert.deepEqual(ranked(map, 'links'), [3, 1, 2, 0]);
  // And the grid follows: its top left corner is whichever page comes first.
  const first = (by: 'in' | 'out') => {
    const at = homes(map, Float32Array.of(1, 1, 1, 1), 1, by);
    return [0, 1, 2, 3].find((page) => at[page * 2] < 0 && at[page * 2 + 1] < 0);
  };
  assert.deepEqual([first('in'), first('out')], [1, 3]);
});
