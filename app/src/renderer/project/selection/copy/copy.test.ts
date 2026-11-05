/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from '@pbnotes/graph';
import { asText, copied, dataUrl, imageNames, picked, unreferenced } from './copy.ts';

const block = (id: string, text: string, ...children: Block[]): Block => ({ id, text, children });
const none = new Map<string, string | null>();

/** A day: `a` with `b` under it and `c` under that, then `d`. */
const day = [block('a', 'A', block('b', 'B', block('c', 'C'))), block('d', 'D')];

test('each picked block comes with its whole subtree, in the order given', () => {
  assert.deepEqual(
    picked([day], ['d', 'b']).map((it) => it.id),
    ['d', 'b'],
  );
  assert.deepEqual(picked([day], ['b'])[0], day[0].children[0]);
});

test('a block under another picked one is copied with it, not again', () => {
  assert.deepEqual(picked([day], ['c', 'a']).map((it) => it.id), ['a']);
});

test('a block shown twice, or held under a parent shown elsewhere, is copied once', () => {
  // The cut shows `b` without `a`, the page it is on shows both.
  const cut = [day[0].children[0]];
  assert.deepEqual(picked([cut, day], ['b', 'a']).map((it) => it.id), ['a']);
  assert.deepEqual(picked([day, cut], ['b', 'b']).map((it) => it.id), ['b']);
  assert.deepEqual(picked([day], ['gone', 'd']).map((it) => it.id), ['d']);
});

test('copied blocks keep their text and nesting, and lose their ids', () => {
  assert.deepEqual(copied([day[0]]), [
    { text: 'A', children: [{ text: 'B', children: [{ text: 'C', children: [] }] }] },
  ]);
});

test('the text is an indented list, two spaces a level', () => {
  assert.equal(asText(day, none), '- A\n  - B\n    - C\n- D');
});

test('a block over several lines keeps them under its item', () => {
  assert.equal(
    asText([block('a', 'first\nsecond\n\nthird', block('b', 'x\ny'))], none),
    '- first\n  second\n\n  third\n  - x\n    y',
  );
});

test('a labelled ref reads its label, a bare one what its block shows, a gone one nothing', () => {
  const previews = new Map<string, string | null>([
    ['p', 'the **plan**'],
    ['gone', null],
    ['blank', ''],
  ]);
  assert.equal(
    unreferenced('Per ((p)), [see](((p))), ((gone))((blank)) and `((p))`.', previews),
    'Per the **plan**, see,  and `((p))`.',
  );
});

test('a ref inside what a ref shows is swapped too, and one that leads back is dropped', () => {
  const previews = new Map<string, string | null>([
    ['a', 'A says ((b))'],
    ['b', 'B says ((a))'],
  ]);
  assert.equal(unreferenced('((a))', previews), 'A says B says ');
});

test('images stay in what the HTML is made from, and are left out of the text', () => {
  const text = 'Look:\n\n![](images/x.png)\n\nthere';
  assert.equal(unreferenced(text, none), text);
  assert.equal(asText([block('a', text)], none), '- Look:\n\n  there');
  assert.equal(asText([block('a', '![](images/x.png)')], none), '-');
});

test('the project images a copy shows are named once, a ref’s included, a web one not', () => {
  const previews = new Map<string, string | null>([['r', '![](images/z.png)']]);
  const blocks = [
    block('a', '![](images/x.png) ![](https://example.com/y.png)', block('b', '![](images/x.png)')),
    block('c', '((r))'),
  ];
  assert.deepEqual(imageNames(blocks, previews), ['x.png', 'z.png']);
});

test('an image is carried as a data URL of its bytes', () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, at) => at % 256);
  const url = dataUrl({ bytes, mime: 'image/png' });
  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.deepEqual(new Uint8Array(Buffer.from(url.split(',')[1], 'base64')), bytes);
});
