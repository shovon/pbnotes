/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from '@pbnotes/graph';
import { beneath, endOf, withIds } from './paste.ts';

const block = (id: string, text: string, ...children: Block[]): Block => ({ id, text, children });

test('every pasted block gets a new id, nested as it was copied', () => {
  let n = 0;
  const newId = () => `id-${++n}`;
  assert.deepEqual(
    withIds([{ text: 'a', children: [{ text: 'b', children: [] }] }, { text: 'c', children: [] }], newId),
    [
      { id: 'id-1', text: 'a', children: [{ id: 'id-2', text: 'b', children: [] }] },
      { id: 'id-3', text: 'c', children: [] },
    ],
  );
});

test('the end of the page with no zoom, and the end of the zoomed block with one', () => {
  assert.deepEqual(endOf(undefined), {});
  assert.deepEqual(endOf(block('r', 'R', block('x', 'X'), block('y', 'Y'))), { after: 'y', parent: 'r' });
  assert.deepEqual(endOf(block('r', 'R')), { parent: 'r' });
});

test('beneath a block, unless it is the zoomed one, whose beneath is out of view', () => {
  const root = block('r', 'R', block('x', 'X'));
  assert.deepEqual(beneath('x', root), { after: 'x' });
  assert.deepEqual(beneath('x', undefined), { after: 'x' });
  assert.deepEqual(beneath('r', root), { after: 'x', parent: 'r' });
});
