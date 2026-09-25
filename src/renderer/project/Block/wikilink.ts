import type { Root, RootContent, Text } from 'mdast';

/**
 * `#[[the good coffee]]` is a link, rendered as `#the good coffee` to a page of that name. It renders as one
 * and goes nowhere: an anchor with no `href`, which is what the platform
 * already means by a link whose target is not settled yet — it takes the link
 * colour, it is not focusable, and clicking it falls through to the block and
 * opens the editor, the same as clicking the words around it.
 *
 * A remark plugin rather than a string replace on the source, because the
 * source is a note and a note is full of code: `#[[...]]` inside a fenced
 * block or a backtick span is text the user typed and has to stay text.
 * Working on the tree gets that for free — `code` and `inlineCode` carry a
 * `value`, not children, so the walk never reaches inside them.
 */
const PATTERN = /#\[\[(.*?)\]\]/g;

/**
 * The custom node renders through `data.hName`; no handler to register. The
 * `#` stays in the label and the brackets do not: the sigil is what marks
 * the words as a link at a glance, and it reads the way it is written
 * everywhere else a tag is written.
 */
function wikilink(label: string): RootContent {
  return {
    type: 'wikilink',
    data: { hName: 'a', hProperties: { className: 'wikilink' } },
    children: [{ type: 'text', value: `#${label}` }],
  } as unknown as RootContent;
}

/** One text node becomes text, link, text… — or stays itself if there is no
    match, so an untouched note keeps the nodes it parsed to. */
function split(node: Text): RootContent[] {
  const out: RootContent[] = [];
  let at = 0;
  for (const match of node.value.matchAll(PATTERN)) {
    if (match.index > at) {
      out.push({ type: 'text', value: node.value.slice(at, match.index) });
    }
    out.push(wikilink(match[1]));
    at = match.index + match[0].length;
  }
  if (out.length === 0) return [node];
  if (at < node.value.length) {
    out.push({ type: 'text', value: node.value.slice(at) });
  }
  return out;
}

export function remarkWikilink() {
  return function walk(node: Root | RootContent): void {
    if (!('children' in node)) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text') return split(child);
      walk(child);
      return child;
    }) as typeof node.children;
  };
}
