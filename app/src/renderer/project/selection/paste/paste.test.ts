/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from '@pbnotes/graph';
import { beneath, endOf, landed, linkedImages, withIds } from './paste.ts';
import type { Copied } from '../clip/clip.ts';

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

const hash = (c: string) => `${c.repeat(64)}.png`;
const tagged = (name: string, src: string) => `<img src="${src}" data-pbnotes-image="${name}"/>`;

test('the images pasted blocks link are named once, a web one not', () => {
  assert.deepEqual(
    linkedImages([
      { text: `![](images/${hash('a')}) ![](https://e.com/x.png)`, children: [{ text: `![](images/${hash('a')})`, children: [] }] },
      { text: `![](images/${hash('b')}) \`![](images/${hash('c')})\``, children: [] },
    ]),
    [hash('a'), hash('b')],
  );
});

test('a paste asks main for each image, with its bytes when the copy carried them, and the token', async () => {
  const asked: unknown[] = [];
  const graph = {
    carryImages: async (images: readonly unknown[], source?: string) => {
      asked.push({ images, source });
      return [`images/${hash('a')}`, `images/${hash('d')}`, undefined];
    },
  };
  const blocks: Copied[] = [
    { text: `A ![](images/${hash('a')})`, children: [{ text: `B ![x](images/${hash('b')} "t")`, children: [] }] },
    { text: `C ![](images/${hash('c')})`, children: [] },
  ];
  const out = await landed(graph, { blocks, source: 'tok' }, `<ul>${tagged(hash('a'), 'data:image/png;base64,AAE=')}</ul>`);
  assert.deepEqual(asked, [
    {
      images: [
        { name: hash('a'), mime: 'image/png', bytes: new Uint8Array([0, 1]) },
        { name: hash('b') },
        { name: hash('c') },
      ],
      source: 'tok',
    },
  ]);
  // `b` landed under another name, and is linked by it; `c` could not be had.
  assert.deepEqual(out, [
    { text: `A ![](images/${hash('a')})`, children: [{ text: `B ![x](images/${hash('d')} "t")`, children: [] }] },
    { text: `C ![](images/${hash('c')})`, children: [] },
  ]);
});

test('a paste with no project images asks main for nothing', async () => {
  const graph = { carryImages: async () => assert.fail('asked') };
  const blocks: Copied[] = [{ text: 'plain', children: [] }];
  assert.equal(await landed(graph, { blocks }, ''), blocks);
});
