/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wanted } from './wanted.ts';

test('a new title is asked for trimmed', () => {
  assert.equal(wanted('  Mira Sato ', 'Mira'), 'Mira Sato');
});

test('a blank title, or the same one, asks for nothing', () => {
  assert.equal(wanted('', 'Mira'), undefined);
  assert.equal(wanted('   ', 'Mira'), undefined);
  assert.equal(wanted(' Mira ', 'Mira'), undefined);
});

test('a change of case is a rename', () => {
  assert.equal(wanted('mira', 'Mira'), 'mira');
});
