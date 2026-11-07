/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from '@pbnotes/graph';
import { carried, decode } from '../../clip/clip.ts';
import { asHtml } from './html.ts';

const block = (id: string, text: string, ...children: Block[]): Block => ({ id, text, children });
const none = new Map<string, string | null>();
const noImages = new Map<string, string>();

/** The HTML without the blocks riding on it, to read at a glance. */
const shown = (html: string) => html.replace(/ data-pbnotes="[^"]*"/, '');

test('blocks are a nested list, each one its Markdown rendered', () => {
  const html = asHtml([block('a', '**A**', block('b', 'B')), block('c', 'C')], none, noImages);
  assert.equal(
    shown(html),
    '<ul><li><p><strong>A</strong></p><ul><li><p>B</p></li></ul></li><li><p>C</p></li></ul>',
  );
});

test('the blocks ride on the list, for a paste into pbnotes', () => {
  const html = asHtml([block('a', 'A [[Mira]] ((r))', block('b', 'B'))], none, noImages);
  assert.deepEqual(decode(html), {
    blocks: [{ text: 'A [[Mira]] ((r))', children: [{ text: 'B', children: [] }] }],
  });
  assert.equal(decode(asHtml([block('a', 'A')], none, noImages, 'tok'))?.source, 'tok');
});

test('a page link reads as it was typed and goes nowhere; a web link still goes', () => {
  const html = shown(asHtml([block('a', '[[Mira]] #work [site](https://example.com)')], none, noImages));
  assert.equal(html, '<ul><li><p>[[Mira]] #work <a href="https://example.com">site</a></p></li></ul>');
});

test('a ref reads what it shows', () => {
  const previews = new Map<string, string | null>([['r', 'the *plan*']]);
  const html = shown(asHtml([block('a', 'Per ((r)), [this](((r))).')], previews, noImages));
  assert.equal(html, '<ul><li><p>Per the <em>plan</em>, this.</p></li></ul>');
});

test('a project image is carried as data, one with no data is left out, a web one kept', () => {
  const images = new Map([['x.png', 'data:image/png;base64,AAAA']]);
  const html = shown(
    asHtml([block('a', '![a](images/x.png) ![b](images/gone.png) ![c](https://e.com/c.png)')], none, images),
  );
  assert.equal(
    html,
    '<ul><li><p><img src="data:image/png;base64,AAAA" alt="a" data-pbnotes-image="x.png"/>  <img src="https://e.com/c.png" alt="c"/></p></li></ul>',
  );
  assert.deepEqual([...carried(html)], [['x.png', 'data:image/png;base64,AAAA']]);
});

test('text that looks like markup stays text', () => {
  const html = shown(asHtml([block('a', 'a <script>x</script> & b')], none, noImages));
  assert.ok(!html.includes('<script>'), html);
});
