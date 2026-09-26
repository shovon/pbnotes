/**
 * Run with: npm test
 *
 * The property that matters is which `#foo` and `[[…]]` become links and
 * which stay text: prose gets linked, code does not, because a note about
 * code is full of strings nobody meant as a link. A `#` in front of brackets
 * replaces them in what is shown; brackets without one stay, as the only mark
 * the words carry; a bare tag is shown as it was typed.
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

/** Every page the plugin linked to, in document order — the `href` minus its
    `#`, or `undefined` for a link that names nothing. */
function pages(node: Node): (string | undefined)[] {
  if (node.type === 'wikilink') {
    const href = (node as { data?: { hProperties?: { href?: string } } }).data
      ?.hProperties?.href;
    return [href?.slice(1)];
  }
  return (node.children ?? []).flatMap(pages);
}

/** Three spellings, one page. The label keeps what was typed; the page it
    names does not: brackets and sigil are syntax, and the spaces just inside
    the brackets are not part of the name. */
test('every spelling of a link names the same page', () => {
  assert.deepEqual(
    pages(parse('[[Mira]] #Mira #[[Mira]] [[ the good coffee ]] #[[ Mira ]]')),
    ['Mira', 'Mira', 'Mira', 'the good coffee', 'Mira'],
  );
});

test('empty brackets name no page', () => {
  assert.deepEqual(pages(parse('[[]] and #[[ ]]')), [undefined, undefined]);
});

test('links prose, and keeps the text around it', () => {
  const [paragraph] = parse('Ask #[[Mira]] about #[[the good coffee]].')
    .children ?? [];
  assert.deepEqual(labels(paragraph), ['#Mira', '#the good coffee']);
  assert.deepEqual(
    (paragraph.children ?? []).map((child) => child.value),
    ['Ask ', undefined, ' about ', undefined, '.'],
  );
});

test('links without the sigil, keeping their brackets', () => {
  const [paragraph] = parse('Ask [[Mira]] about #[[the good coffee]].')
    .children ?? [];
  assert.deepEqual(labels(paragraph), ['[[Mira]]', '#the good coffee']);
  assert.deepEqual(
    (paragraph.children ?? []).map((child) => child.value),
    ['Ask ', undefined, ' about ', undefined, '.'],
  );
});

test('links a single word with no brackets at all', () => {
  const [paragraph] = parse('Ask #Mira about #[[the good coffee]].')
    .children ?? [];
  assert.deepEqual(labels(paragraph), ['#Mira', '#the good coffee']);
  assert.deepEqual(
    (paragraph.children ?? []).map((child) => child.value),
    ['Ask ', undefined, ' about ', undefined, '.'],
  );
});

test('where a bare tag ends', () => {
  const source = '#bar-baz, #snake_case; #café; #日本語; #work/urgent; #work/; #foo-';
  assert.deepEqual(labels(parse(source)), [
    '#bar-baz',
    '#snake_case',
    '#café',
    '#日本語',
    '#work/urgent',
    '#work',
    '#foo',
  ]);
});

/** Pinned so that sparing issue references later is a deliberate choice, not
    a regression. Nothing separates `#fff` from `#cafe`, so it links too. */
test('a bare tag may be all digits', () => {
  assert.deepEqual(
    labels(parse('Closes #123, and the background is #3366ff.')),
    ['#123', '#3366ff'],
  );
});

test('what a bare # does not pick up', () => {
  assert.deepEqual(labels(parse('See https://example.com/#top and a#b.')), []);
  assert.deepEqual(labels(parse('####Foo')), []);
  assert.deepEqual(labels(parse('# Heading\n\nbody')), []);
  assert.deepEqual(labels(parse('Try `grep #Mira` first.')), []);
});

test('links inside headings and list items too', () => {
  assert.deepEqual(labels(parse('## On #[[Mira]]\n\n- see #[[the shed]]')), [
    '#Mira',
    '#the shed',
  ]);
});

test('leaves code alone', () => {
  assert.deepEqual(labels(parse('Try `grep [[foo]]` first.')), []);
  assert.deepEqual(labels(parse('```\ngrep #[[foo]]\n```')), []);
});

test('a note with none of them is untouched', () => {
  assert.deepEqual(
    labels(parse('Nothing to see, [a link](https://example.com).')),
    [],
  );
});
