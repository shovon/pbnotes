/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearEdge } from './gesture.ts';

test('away from both edges, nothing scrolls', () => {
  assert.equal(nearEdge(300, 0, 600), 0);
});

test('near the top it scrolls up, and the closer the faster', () => {
  assert.equal(nearEdge(30, 0, 600), -10);
  assert.equal(nearEdge(0, 0, 600), -40);
});

test('near the bottom it scrolls down', () => {
  assert.equal(nearEdge(590, 0, 600), 30);
});

test('the edges are those of the box handed in, not the window (#305)', () => {
  // A column from 36 to 500: its own top edge, not the window's.
  assert.equal(nearEdge(60, 36, 500), -16);
  assert.equal(nearEdge(470, 36, 500), 10);
  assert.equal(nearEdge(300, 36, 500), 0);
});
