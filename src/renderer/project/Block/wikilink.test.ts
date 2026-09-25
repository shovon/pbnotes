/**
 * Run with: npm test
 *
 * The property that matters is which `#[[…]]` become links and which stay
 * text: prose gets linked, code does not, because a note about code is full
 * of strings nobody meant as a link. The brackets are dropped from what is
 * shown; the `#` is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkWikilink } from './wikilink.ts';

type Node = { type: string; value?: string; children?: Node[] };

const md = unified().use(remarkParse).use(remarkWikilink);

const parse = (source: string) => md.runSync(md.parse(source)) as Node;

/** Every label the plugin turned into a link, in document order. */
function labels(node: Node): string[] {
  if (node.type === 'wikilink') return [node.children?.[0]?.value ?? ''];
  return (node.children ?? []).flatMap(labels);
}

test('links prose, and keeps the text around it', () => {
  const [paragraph] = parse('Ask #[[Mira]] about #[[the good coffee]].')
    .children ?? [];
  assert.deepEqual(labels(paragraph), ['#Mira', '#the good coffee']);
  assert.deepEqual(
    (paragraph.children ?? []).map((child) => child.value),
    ['Ask ', undefined, ' about ', undefined, '.'],
  );
});

test('links inside headings and list items too', () => {
  assert.deepEqual(labels(parse('## On #[[Mira]]\n\n- see #[[the shed]]')), [
    '#Mira',
    '#the shed',
  ]);
});

test('leaves code alone', () => {
  assert.deepEqual(labels(parse('Try `grep #[[foo]]` first.')), []);
  assert.deepEqual(labels(parse('```\ngrep #[[foo]]\n```')), []);
});

test('a note with none of them is untouched', () => {
  assert.deepEqual(
    labels(parse('Nothing to see, [a link](https://example.com).')),
    [],
  );
});
