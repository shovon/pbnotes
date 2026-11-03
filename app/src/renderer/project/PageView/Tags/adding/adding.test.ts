/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adding, offered } from './adding.ts';

test('nothing typed, once trimmed, is blank', () => {
  assert.deepEqual(adding(['Work'], ''), { kind: 'blank' });
  assert.deepEqual(adding(['Work'], '   '), { kind: 'blank' });
});

test('a tag the page has is held, in any case or spacing, and names the chip as drawn', () => {
  assert.deepEqual(adding(['Work', 'Home'], 'Work'), { kind: 'held', tag: 'Work' });
  assert.deepEqual(adding(['Work', 'Home'], ' WORK '), { kind: 'held', tag: 'Work' });
});

test('a new tag is added, trimmed', () => {
  assert.deepEqual(adding([], ' Reading '), { kind: 'add', tag: 'Reading' });
  assert.deepEqual(adding(['Work'], 'Workshop'), { kind: 'add', tag: 'Workshop' });
});

test('suggestions leave out the tags the page has, in any case', () => {
  assert.deepEqual(offered(['Work', 'workshop', 'Home'], ['work', 'Home']), ['workshop']);
  assert.deepEqual(offered(['Work'], []), ['Work']);
});
