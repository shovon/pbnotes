/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_TASKS } from '../../../../shared/graph.ts';
import type { Filter } from '../../../../shared/graph.ts';
import { chips, picked, unchipped } from './filter.ts';

test('the open tasks show as a chip for each marker', () => {
  assert.deepEqual(chips(OPEN_TASKS), [
    { kind: 'marker', marker: 'TODO' },
    { kind: 'marker', marker: 'DOING' },
  ]);
  assert.deepEqual(chips([]), []);
});

test('picking a marker turns it on, and picking it again turns it off', () => {
  const on = picked(OPEN_TASKS, { kind: 'marker', marker: 'DONE' });
  assert.deepEqual(on, [{ kind: 'marker', markers: ['TODO', 'DOING', 'DONE'] }]);
  assert.deepEqual(picked(on, { kind: 'marker', marker: 'DONE' }), OPEN_TASKS);
});

test('picking a marker with no marker condition starts one', () => {
  assert.deepEqual(picked([], { kind: 'marker', marker: 'DONE' }), [{ kind: 'marker', markers: ['DONE'] }]);
});

test('a chip taken off leaves the rest, and the last takes its condition with it', () => {
  const one = unchipped(OPEN_TASKS, { kind: 'marker', marker: 'TODO' });
  assert.deepEqual(one, [{ kind: 'marker', markers: ['DOING'] }]);
  assert.deepEqual(unchipped(one, { kind: 'marker', marker: 'DOING' }), []);
  assert.deepEqual(picked(one, { kind: 'marker', marker: 'DOING' }), []);
});

test('taking off a chip the filter does not hold changes nothing', () => {
  const filter: Filter = OPEN_TASKS;
  assert.equal(unchipped(filter, { kind: 'marker', marker: 'DONE' }), filter);
  assert.equal(unchipped([], { kind: 'marker', marker: 'DONE' }).length, 0);
});

test('a step never changes the filter it was handed', () => {
  const filter: Filter = [{ kind: 'marker', markers: ['TODO'] }];
  picked(filter, { kind: 'marker', marker: 'DONE' });
  unchipped(filter, { kind: 'marker', marker: 'TODO' });
  assert.deepEqual(filter, [{ kind: 'marker', markers: ['TODO'] }]);
});
