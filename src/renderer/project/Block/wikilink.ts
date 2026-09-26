import type { Root, RootContent, Text } from 'mdast';

/**
 * A hashtag and a link are the same idea here, so there is one plugin and
 * three ways of writing what it makes. `#Mira` is the short way and wants no
 * ceremony; brackets are for a name with a space in it, `#[[the good
 * coffee]]`, which renders as `#the good coffee`; and `[[Mira]]` without the
 * sigil keeps its brackets, because with nothing in front of the words they
 * are all that marks them as a link and dropping them would leave coloured
 * prose. All three name the same page, `Mira`, and carry it as `href="#Mira"`:
 * a real link, so it is focusable, takes the pointer, and Enter follows it.
 * The fragment form never leaves the window on its own — the project view
 * catches the click before the block does and opens the page instead. Empty
 * brackets name nothing and get no `href`, so they stay an inert anchor
 * rather than a link to a page called nothing.
 *
 * A remark plugin rather than a string replace on the source, because the
 * source is a note and a note is full of code: `#foo` inside a fenced block
 * or a backtick span is text the user typed and has to stay text. Working on
 * the tree gets that for free — `code` and `inlineCode` carry a `value`, not
 * children, so the walk never reaches inside them.
 *
 * The bracketed forms come first in the alternation, so `#[[a b]]` is never
 * read as a bare `#` with nothing after it. A bare tag starts and ends with a
 * letter, digit or underscore and may run through `-` and `/` in between, so
 * `Ask #Mira.` leaves the full stop behind and `#work/` leaves the slash.
 * `\p{L}` over `\w` for the same keystrokes, so `#café` and `#日本語` work.
 *
 * The lookbehind is what keeps a pasted URL from sprouting a link: nothing is
 * autolinking bare URLs, so `https://example.com/#top` arrives as a text node
 * the walk does descend into, and `#top` would be coloured. It blocks `a#b`
 * mid-word and `####Foo` on the same rule.
 */
const PATTERN =
  /(#?)\[\[(.*?)\]\]|(?<![\p{L}\p{N}/#])#[\p{L}\p{N}_](?:[\p{L}\p{N}_/-]*[\p{L}\p{N}_])?/gu;

/**
 * The custom node renders through `data.hName`; no handler to register. The
 * label is what the user typed, minus the brackets when a `#` stands in for
 * them: a tag reads the way a tag reads everywhere else, and a link written
 * without one keeps the only mark it has. The bare form has nothing to strip,
 * so it is carried through whole — which is also why the caller can hand the
 * raw match straight over.
 *
 * `title` is the page it names, trimmed: `[[ Mira ]]` and `[[Mira]]` are one
 * page, and a title is a key in a log that keeps everything forever.
 */
function wikilink(label: string, title: string): RootContent {
  return {
    type: 'wikilink',
    data: {
      hName: 'a',
      hProperties: {
        className: 'wikilink',
        ...(title ? { href: `#${title}` } : {}),
      },
    },
    children: [{ type: 'text', value: label }],
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
    // The bare branch captures nothing, so `match[2]` is undefined there: the
    // whole match is the label, and the page is the match minus its `#`. Give
    // that branch a group and the two bracketed forms break.
    const bracketed = match[2] !== undefined;
    out.push(
      bracketed
        ? wikilink(match[1] ? `#${match[2]}` : match[0], match[2].trim())
        : wikilink(match[0], match[0].slice(1)),
    );
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
