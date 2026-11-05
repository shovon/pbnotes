/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTRIBUTE, decode, encode } from './clip.ts';
import type { Copied } from './clip.ts';

const blocks: Copied[] = [
  { text: 'one "quoted" <b>&amp;</b> ✓ 日本語', children: [{ text: 'one.1', children: [] }] },
  { text: '', children: [] },
];

/** The attribute as a copy writes it, inside whatever HTML is around it. */
const html = (value: string) => `<meta charset="utf-8"><ul ${ATTRIBUTE}="${value}"><li>x</li></ul>`;

test('blocks go in and come back out the same, whatever their text holds', () => {
  assert.deepEqual(decode(html(encode(blocks))), blocks);
});

test('HTML with no blocks in it, or blocks that do not read, is not a paste of blocks', () => {
  const json = (it: unknown) => Buffer.from(JSON.stringify(it)).toString('base64');
  for (const bad of [
    '<p>hello</p>',
    html('not base64!'),
    html(btoa('not json')),
    html(json({ v: 2, blocks })),
    html(json({ blocks })),
    html(json({ v: 1, blocks: [] })),
    html(json({ v: 1, blocks: [{ text: 1, children: [] }] })),
    html(json({ v: 1, blocks: [{ text: 'x' }] })),
    html(json({ v: 1, blocks: [null] })),
    html(json({ v: 1, blocks: 'x' })),
  ]) {
    assert.equal(decode(bad), undefined, bad);
  }
});

test('what a block does not read is left behind', () => {
  const value = btoa(JSON.stringify({ v: 1, blocks: [{ text: 'x', children: [], id: 'old', page: 'P' }] }));
  assert.deepEqual(decode(html(value)), [{ text: 'x', children: [] }]);
});

test('too many blocks, or too deep, is not read', () => {
  const many = Array.from({ length: 10_001 }, (): Copied => ({ text: '', children: [] }));
  assert.equal(decode(html(encode(many))), undefined);
  let deep: Copied = { text: '', children: [] };
  for (let i = 0; i < 100; i++) deep = { text: '', children: [deep] };
  assert.equal(decode(html(encode([deep]))), undefined);
});
