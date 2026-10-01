import type { Root, RootContent, Text } from 'mdast';
import remarkMath from 'remark-math';

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
 * An alias, `[foo]([[Foo Page]])`, is a fourth spelling: it opens `Foo Page`
 * and reads `[[foo]]`, brackets kept for the same reason as above. Remark
 * makes a `link` node of it when the target has no space, and plain text when
 * it does, so both are handled: the node in the walk, the text here. It comes
 * first in the alternation, or its `[[Foo Page]]` is taken on its own and
 * `[foo](` and `)` are left behind as text.
 *
 * ponytail: a formatted label with a spaced target, `[**foo**]([[X Y]])`,
 * stays text — remark splits it across nodes, so no one text node holds it
 * whole. Stitch siblings back together if anyone writes that.
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
 *
 * `((ID))` is a block ref, with a group of its own. An id has no spaces or
 * parentheses in it, so `f((x))` in prose about code is the only thing it
 * can take by mistake.
 */
const PATTERN =
  /\[([^[\]]*)\]\(\[\[(.*?)\]\]\)|(#?)\[\[(.*?)\]\]|\(\(([^()\s]+)\)\)|(?<![\p{L}\p{N}/#])#[\p{L}\p{N}_](?:[\p{L}\p{N}_/-]*[\p{L}\p{N}_])?/gu;

/**
 * The custom node renders through `data.hName`; no handler to register. The
 * label is what the user typed, minus the brackets when a `#` stands in for
 * them: a tag reads the way a tag reads everywhere else, and a link written
 * without one keeps the only mark it has. The bare form has nothing to strip,
 * so it is carried through whole — which is also why the caller can hand the
 * raw match straight over. Nodes rather than a string, so an alias's label
 * keeps the bold or code it was written with.
 *
 * `title` is the page it names, trimmed: `[[ Mira ]]` and `[[Mira]]` are one
 * page, and a title is a key in a log that keeps everything forever.
 */
function wikilink(title: string, ...label: RootContent[]): RootContent {
  return {
    type: 'wikilink',
    data: {
      hName: 'a',
      hProperties: {
        className: 'wikilink',
        ...(title ? { href: `#${title}` } : {}),
      },
    },
    children: label,
  } as unknown as RootContent;
}

/**
 * A reference to a block, by its id. Not an `a`: what it shows is the other
 * block's words, which the tree does not hold, so it renders through an
 * element of its own that the block view supplies a component for. With a
 * label — `[foo](((ID)))` — it shows the label; without, the node is empty
 * and the view fills it.
 */
function blockRef(id: string, ...label: RootContent[]): RootContent {
  return {
    type: 'blockRef',
    data: { hName: 'block-ref', hProperties: { dataBlockRef: id } },
    children: label,
  } as unknown as RootContent;
}

const text = (value: string): Text => ({ type: 'text', value });

/** One text node becomes text, link, text… — or stays itself if there is no
    match, so an untouched note keeps the nodes it parsed to. */
function split(node: Text): RootContent[] {
  const out: RootContent[] = [];
  let at = 0;
  for (const match of node.value.matchAll(PATTERN)) {
    if (match.index > at) {
      out.push(text(node.value.slice(at, match.index)));
    }
    // Each branch fills only its own groups, so which one is defined says
    // which form matched. The bare branch captures nothing: the whole match
    // is the label, and the page is the match minus its `#`. Give that branch
    // a group and the forms above it break.
    if (match[2] !== undefined) {
      out.push(wikilink(match[2].trim(), text(`[[${match[1]}]]`)));
    } else if (match[4] !== undefined) {
      const label = match[3] ? `#${match[4]}` : match[0];
      out.push(wikilink(match[4].trim(), text(label)));
    } else if (match[5] !== undefined) {
      out.push(blockRef(match[5]));
    } else {
      out.push(wikilink(match[0].slice(1), text(match[0])));
    }
    at = match.index + match[0].length;
  }
  if (out.length === 0) return [node];
  if (at < node.value.length) {
    out.push(text(node.value.slice(at)));
  }
  return out;
}

/**
 * The two remark plugins a note is read with, in the order they run. Math
 * first: `$…$` becomes a node without text children, so a `#` inside a
 * formula never becomes a link.
 *
 * In `shared`, against the rule that this folder holds types and constants,
 * for the reason `locate` gives in `pages.ts`: both sides genuinely need it.
 * The renderer renders a block with it; main reads a block with it to find
 * the pages it links to, which is how a page lists what links to it. Two
 * parsers that have to agree on what a link is would be one more than
 * anyone can keep in step — a `#foo` in a code span would render as text
 * and count as a reference. No `node:` imports, so the rule's reason holds.
 */
export const remarkPlugins = [remarkMath, remarkWikilink];

export function remarkWikilink() {
  return function walk(node: Root | RootContent): void {
    if (!('children' in node)) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text') return split(child);
      // An alias whose target has no space: remark already made it a link,
      // to the URL `[[Foo]]`. Its label keeps whatever formatting it had,
      // and is not walked — a tag inside it would be a link inside a link.
      const alias = child.type === 'link' && /^\[\[(.*)\]\]$/.exec(child.url);
      if (alias) {
        const label = [text('[['), ...child.children, text(']]')];
        return wikilink(alias[1].trim(), ...label);
      }
      // `[foo](((ID)))`: an id has no space, so remark always makes a link
      // of this one and there is no text form to catch.
      const ref =
        child.type === 'link' && /^\(\(([^()\s]+)\)\)$/.exec(child.url);
      if (ref) return blockRef(ref[1], ...child.children);
      walk(child);
      return child;
    }) as typeof node.children;
  };
}
