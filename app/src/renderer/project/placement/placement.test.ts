/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Block, Page } from '@pbnotes/pages';
import { imageTarget, placeNew } from './placement.ts';

const block = (id: string, children: Block[] = []): Block => ({
  id,
  text: id,
  children,
});

test('beneath the block it is told, in one step', () => {
  assert.deepEqual(placeNew(undefined, 'a'), { after: 'a', indent: false });
  assert.deepEqual(placeNew(block('r'), 'a'), { after: 'a', indent: false });
});

test('with nothing to go beneath and no zoom, at the end of the page', () => {
  assert.deepEqual(placeNew(undefined), { indent: false });
});

test('zoomed, last under the root: beneath its last child, or beside a bare root and then under it', () => {
  assert.deepEqual(placeNew(block('r', [block('a'), block('b')])), {
    after: 'b',
    indent: false,
  });
  assert.deepEqual(placeNew(block('r')), { after: 'r', indent: true });
});

const day = (title: string, blocks: Block[] = []): Page => ({ title, blocks });

test('an image goes on the page dropped on, else the one showing, else today', () => {
  const showing = [day('2026-10-28'), day('Mira')];
  const at = (dropped: string | undefined, title: string | null) =>
    imageTarget({ dropped, title, today: '2026-10-28', showing }).page;
  assert.equal(at('Mira', null), 'Mira');
  assert.equal(at(undefined, 'Mira'), 'Mira');
  assert.equal(at(undefined, null), '2026-10-28');
});

test('zoomed, an image goes under the zoomed block, found by key, and only on the zoomed page', () => {
  const zoomed = block('z', [block('c')]);
  const showing = [day('Mira', [block('a', [zoomed])])];
  // The trail spelt the link in other case: still the page showing.
  assert.equal(
    imageTarget({ title: 'mira', today: 'x', showing, zoom: 'z' }).root,
    zoomed,
  );
  assert.equal(
    imageTarget({ dropped: 'Juno', title: 'Mira', today: 'x', showing, zoom: 'z' })
      .root,
    undefined,
  );
  // A zoom the page does not have, or no zoom: the end of the page.
  assert.equal(
    imageTarget({ title: 'Mira', today: 'x', showing, zoom: 'gone' }).root,
    undefined,
  );
  assert.equal(imageTarget({ title: 'Mira', today: 'x', showing }).root, undefined);
});
