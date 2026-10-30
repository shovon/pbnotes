/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkPlugins } from '@pbnotes/pages';
import { remarkHighlight, remarkStrikethrough } from './marks.ts';

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hProperties?: { href?: string } };
};

const md = unified()
  .use(remarkParse)
  .use([...remarkPlugins, remarkStrikethrough, remarkHighlight]);
const parse = (source: string) => md.runSync(md.parse(source)) as Node;

/** The text a node reads as, formatting dropped. */
const read = (node: Node): string =>
  node.value ?? (node.children ?? []).map(read).join('');

/** Every node of a type, in document order. */
const all = (node: Node, type: string): Node[] => [
  ...(node.type === type ? [node] : []),
  ...(node.children ?? []).flatMap((child) => all(child, type)),
];

const pages = (node: Node) =>
  all(node, 'wikilink').map((link) => link.data?.hProperties?.href?.slice(1));

/** A link struck through is still a link; tildes in code, math or alone stay
    what was typed. */
test('~~strikethrough~~ wraps its words, links and all', () => {
  const tree = parse('~~done [[Mira]]~~ `~~a~~` $~~b~~$ ~c~');
  assert.deepEqual(all(tree, 'delete').map(read), ['done [[Mira]]']);
  assert.deepEqual(pages(tree), ['Mira']);
  assert.match(read(tree), /~~a~~.*~~b~~.*~c~/);
});

/** Both spellings highlight, links inside still count; code, math, single
    markers, spaced markers and mismatched pairs stay what was typed. */
test('==highlight== and ^^highlight^^ wrap their words, links and all', () => {
  const tree = parse(
    '==done [[Mira]]== ^^#Ada^^ `==a==` $==b==$ a = b 2^3 x == y == z ==c^^ ===d===',
  );
  assert.deepEqual(all(tree, 'highlight').map(read), ['done [[Mira]]', '#Ada']);
  assert.deepEqual(pages(tree), ['Mira', 'Ada']);
  assert.match(
    read(tree),
    /==a==.*==b==.*a = b 2\^3 x == y == z ==c\^\^ ===d===/,
  );
});
