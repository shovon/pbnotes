/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTRIBUTE, bytesOf, carried, decode, encode, IMAGE_ATTRIBUTE } from './clip.ts';
import type { Copied } from './clip.ts';

const blocks: Copied[] = [
  { text: 'one "quoted" <b>&amp;</b> ✓ 日本語', children: [{ text: 'one.1', children: [] }] },
  { text: '', children: [] },
];

/** The attribute as a copy writes it, inside whatever HTML is around it. */
const html = (value: string) => `<meta charset="utf-8"><ul ${ATTRIBUTE}="${value}"><li>x</li></ul>`;

test('blocks go in and come back out the same, whatever their text holds', () => {
  assert.deepEqual(decode(html(encode(blocks))), { blocks });
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
  assert.deepEqual(decode(html(value)), { blocks: [{ text: 'x', children: [] }] });
});

test('too many blocks, or too deep, is not read', () => {
  const many = Array.from({ length: 10_001 }, (): Copied => ({ text: '', children: [] }));
  assert.equal(decode(html(encode(many))), undefined);
  let deep: Copied = { text: '', children: [] };
  for (let i = 0; i < 100; i++) deep = { text: '', children: [deep] };
  assert.equal(decode(html(encode([deep]))), undefined);
});

test('a token for images too big to carry rides along, and one too long to be a token does not', () => {
  assert.deepEqual(decode(html(encode(blocks, 'tok-1'))), { blocks, source: 'tok-1' });
  assert.deepEqual(decode(html(encode(blocks, 'x'.repeat(65)))), { blocks });
});

test('the images a copy carries are read by name, each once, and only as bare file names', () => {
  const img = (name: string, src: string) => `<img src="${src}" ${IMAGE_ATTRIBUTE}="${name}" alt=""/>`;
  const found = carried(
    `<ul>${img('a.png', 'data:image/png;base64,AAAA')}${img('a.png', 'data:image/png;base64,BBBB')}` +
      `${img('../x.png', 'data:image/png;base64,CCCC')}${img('b.png', 'https://e.com/b.png')}` +
      `<img src="data:image/png;base64,DDDD"/></ul>`,
  );
  assert.deepEqual([...found], [['a.png', 'data:image/png;base64,AAAA']]);
});

test('a data URL gives back its bytes and type, anything else nothing', () => {
  assert.deepEqual(bytesOf('data:image/png;base64,AAEC'), { mime: 'image/png', bytes: new Uint8Array([0, 1, 2]) });
  assert.equal(bytesOf('https://e.com/x.png'), undefined);
  assert.equal(bytesOf('data:image/png,raw'), undefined);
});
