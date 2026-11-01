/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Place } from '../../../shared/pages.ts';
import { keep } from './held.ts';
import type { Held } from './held.ts';

const at = (place: Place | undefined, version: number): Held => ({
  place,
  view: { version, showing: [], previews: [] },
});
const mira = { page: 'Mira' };

test('a newer answer for the place the window is on replaces the one held', () => {
  const next = at(mira, 4);
  assert.equal(keep(at(mira, 3), mira, next), next);
});

test('an older answer for the same place is ignored', () => {
  const held = at(mira, 4);
  assert.equal(keep(held, mira, at(mira, 3)), held);
});

test('an answer at the same version replaces the one held, for a day that rolled over', () => {
  const next = at(undefined, 4);
  assert.equal(keep(at(undefined, 4), undefined, next), next);
});

test('an answer for a place the window has left is ignored', () => {
  const held = at(mira, 4);
  assert.equal(keep(held, mira, at(undefined, 9)), held);
  assert.equal(keep(null, mira, at({ page: 'Mira', block: 'b1' }, 9)), null);
});

test('the first answer for a new place replaces a view of the old one, whatever its version', () => {
  const next = at(mira, 2);
  assert.equal(keep(at(undefined, 7), mira, next), next);
});

test('a rezoom out to the page is the page, with or without the block key', () => {
  const next = at({ page: 'Mira', block: undefined }, 5);
  assert.equal(keep(null, mira, next), next);
});
