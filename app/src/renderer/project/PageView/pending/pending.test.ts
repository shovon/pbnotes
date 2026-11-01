/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockEdited } from '@pbnotes/pages';
import { drawn, recorded, refused, unseen } from './pending.ts';

const a = blockEdited('b1', 'one');
const b = blockEdited('b1', 'two');
const events = (all: { event: unknown }[]) => all.map((it) => it.event);

test('an event tagged n stays drawn over a view at n - 1, and is dropped by one at n', () => {
  const all = recorded(drawn([], [a]), a, 5);
  assert.deepEqual(events(unseen(all, 4)), [a]);
  assert.deepEqual(events(unseen(all, 5)), []);
  assert.deepEqual(events(unseen(all, 6)), []);
});

test('an event with no reply yet is drawn over every view', () => {
  assert.deepEqual(events(unseen(drawn([], [a]), 100)), [a]);
});

test('a view that arrives before the reply still drops the event once the reply tags it', () => {
  // The view at 5 is already held when the reply naming 5 comes back.
  let all = drawn([], [a]);
  assert.deepEqual(events(unseen(all, 5)), [a]);
  all = recorded(all, a, 5);
  assert.deepEqual(events(unseen(all, 5)), []);
});

test('a reply with no version drops its event at once', () => {
  assert.deepEqual(events(recorded(drawn([], [a, b]), a, undefined)), [b]);
});

test('a refused write drops what is not recorded, and keeps what is', () => {
  let all = drawn([], [a, b]);
  all = recorded(all, a, 3);
  all = refused(all, [a, b]);
  assert.deepEqual(events(all), [a]);
  assert.deepEqual(all[0].version, 3);
});
