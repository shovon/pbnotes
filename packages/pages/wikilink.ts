import type { Link, Root, RootContent, Text } from 'mdast';
import type { Processor } from 'unified';
import remarkMath from 'remark-math';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type {
  Code,
  Construct,
  Event,
  Resolver,
  State,
  Token,
  Tokenizer,
} from 'micromark-util-types';
import { splice } from 'micromark-util-chunked';
import { classifyCharacter } from 'micromark-util-classify-character';
import { resolveAll } from 'micromark-util-resolve-all';

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
 * The lookbehind blocks `a#b` mid-word and `####Foo`. A URL's `#top` no
 * longer reaches it as text — the URL is a link by then, see `split` — but
 * the `/` stays in it for the URL written inside brackets, `[[a/#b]]`.
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

/**
 * A bare URL as GFM reads it, `https://example.com`, `www.example.com` or
 * `mira@example.com`: a link labelled with its own URL, scheme aside. Some
 * come from micromark and some from a pass after it, without a position, so
 * the label is the one thing they share. `<https://…>` and `[https://…](…)`
 * pass for one too, which is harmless: read back as text they are the same.
 */
function bare(node: RootContent): node is Link {
  if (node.type !== 'link' || node.children.length !== 1) return false;
  const [label] = node.children;
  if (label.type !== 'text') return false;
  return [label.value, `http://${label.value}`, `mailto:${label.value}`]
    .includes(node.url);
}

/**
 * A run of text and bare URLs becomes text, link, text… — or stays itself if
 * nothing in it matches, so an untouched note keeps the nodes it parsed to.
 *
 * The run is read as the one string it was typed as, because micromark finds
 * URLs before this walk finds links, and each would cut the other short:
 * `[[https://example.com]]` arrives as `[[`, a link, `]]`, and the page goes
 * missing; `https://a.com/((b))` holds a block ref that is not one. Whichever
 * starts first wins and swallows what overlaps it. A URL swallowed by a link
 * becomes part of its label; a link that starts inside a URL is never seen.
 */
function split(run: (Text | Link)[]): RootContent[] {
  let value = '';
  const urls: { start: number; end: number; node: Link }[] = [];
  for (const node of run) {
    const start = value.length;
    value += node.type === 'text' ? node.value : read(node);
    if (node.type === 'link') urls.push({ start, end: value.length, node });
  }
  const re = new RegExp(PATTERN);
  const out: RootContent[] = [];
  let at = 0;
  let next = 0;
  let matched = false;
  for (;;) {
    re.lastIndex = at;
    const match = re.exec(value);
    const url = urls[next];
    if (url && (!match || url.start < match.index)) {
      if (url.start > at) out.push(text(value.slice(at, url.start)));
      out.push(url.node);
      at = url.end;
      next++;
      continue;
    }
    if (!match) break;
    matched = true;
    if (match.index > at) out.push(text(value.slice(at, match.index)));
    out.push(linkFor(match));
    at = match.index + match[0].length;
    while (urls[next] && urls[next].start < at) next++;
  }
  if (!matched) return run;
  if (at < value.length) out.push(text(value.slice(at)));
  return out;
}

/** Each branch fills only its own groups, so which one is defined says which
    form matched. The bare branch captures nothing: the whole match is the
    label, and the page is the match minus its `#`. Give that branch a group
    and the forms above it break. */
function linkFor(match: RegExpExecArray): RootContent {
  if (match[2] !== undefined) {
    return wikilink(match[2].trim(), text(`[[${match[1]}]]`));
  }
  if (match[4] !== undefined) {
    const label = match[3] ? `#${match[4]}` : match[0];
    return wikilink(match[4].trim(), text(label));
  }
  if (match[5] !== undefined) return blockRef(match[5]);
  return wikilink(match[0].slice(1), text(match[0]));
}

/** The text a link reads as. A bare URL's label is one text node. */
const read = (node: Link) => (node.children[0] as Text).value;

/**
 * `~~foo~~`, and only that piece of GFM: `remark-gfm` would also bring
 * tables, task lists, footnotes and bare-URL autolinks, each of which changes
 * how existing notes look. A single `~` stays text, so `~5 min` is safe.
 * Rendering needs nothing more — the `delete` node already becomes `<del>`.
 */
function remarkStrikethrough(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(
    gfmStrikethrough({ singleTilde: false }),
  );
  (data.fromMarkdownExtensions ??= []).push(gfmStrikethroughFromMarkdown());
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    highlight: 'highlight';
    highlightSequence: 'highlightSequence';
    highlightSequenceTemporary: 'highlightSequenceTemporary';
    highlightText: 'highlightText';
  }
}

const EQUALS = 61;
const CARET = 94;

/**
 * `==foo==`, Obsidian's highlight, and `^^foo^^`, Roam's: one node, drawn as
 * `<mark>`. The tokenizer is GFM strikethrough's with the tilde swapped out —
 * the same flanking rules, so `a == b` and `x ^^ y` stay text, and the same
 * doubled marker, so `a = b` and `2^3` do too. What it adds is that a closer
 * has to be the marker its opener was: `==a^^` highlights nothing.
 *
 * ponytail: a bare URL right before the closer, `==see https://a.com==`,
 * takes the `==` into the URL and nothing is highlighted — the autolink
 * extension's list of trailing punctuation to drop is fixed and has `~` but
 * not `=` or `^`. A space before the closer does not help either. Fork that
 * tokenizer's trail check if anyone highlights links.
 */
function remarkHighlight(this: Processor) {
  const tokenizer: Construct = {
    name: 'highlight',
    tokenize: tokenizeHighlight,
    resolveAll: resolveAllHighlight,
  };
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    text: { [EQUALS]: tokenizer, [CARET]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [EQUALS, CARET] },
  });
  (data.fromMarkdownExtensions ??= []).push({
    canContainEols: ['highlight'],
    enter: {
      highlight(token) {
        const node = {
          type: 'highlight',
          children: [] as RootContent[],
          data: { hName: 'mark' },
        };
        this.enter(node as never, token);
      },
    },
    exit: {
      highlight(token) {
        this.exit(token);
      },
    },
  } satisfies FromMarkdownExtension);
}

/** Pair each closer with the nearest opener spelled the same way. */
const resolveAllHighlight: Resolver = (events, context) => {
  for (let index = 0; index < events.length; index++) {
    const close = events[index][1];
    if (
      events[index][0] !== 'enter' ||
      close.type !== 'highlightSequenceTemporary' ||
      !close._close
    ) {
      continue;
    }
    let open = index;
    while (open--) {
      const opener = events[open][1];
      if (
        events[open][0] === 'exit' &&
        opener.type === 'highlightSequenceTemporary' &&
        opener._open &&
        context.sliceSerialize(opener) === context.sliceSerialize(close)
      ) {
        opener.type = 'highlightSequence';
        close.type = 'highlightSequence';
        const highlight: Token = {
          type: 'highlight',
          start: { ...opener.start },
          end: { ...close.end },
        };
        const text: Token = {
          type: 'highlightText',
          start: { ...opener.end },
          end: { ...close.start },
        };
        const next: Event[] = [
          ['enter', highlight, context],
          ['enter', opener, context],
          ['exit', opener, context],
          ['enter', text, context],
        ];
        const insideSpan = context.parser.constructs.insideSpan.null;
        if (insideSpan) {
          splice(
            next,
            next.length,
            0,
            resolveAll(insideSpan, events.slice(open + 1, index), context),
          );
        }
        splice(next, next.length, 0, [
          ['exit', text, context],
          ['enter', close, context],
          ['exit', close, context],
          ['exit', highlight, context],
        ]);
        splice(events, open - 1, index - open + 3, next);
        index = open + next.length - 2;
        break;
      }
    }
  }
  for (const [, token] of events) {
    if (token.type === 'highlightSequenceTemporary') token.type = 'data';
  }
  return events;
};

/** Exactly two of one marker; whether they open, close or both is down to
    what is either side of them, as with `~~`. */
const tokenizeHighlight: Tokenizer = function (effects, ok, nok) {
  const previous = this.previous;
  const events = this.events;
  let marker: Code = null;
  let size = 0;
  const more: State = (code) => {
    if (code === marker) {
      if (size > 1) return nok(code);
      effects.consume(code);
      size++;
      return more;
    }
    if (size < 2) return nok(code);
    const token = effects.exit('highlightSequenceTemporary');
    const before = classifyCharacter(previous);
    const after = classifyCharacter(code);
    token._open = !after || (after === 2 && Boolean(before));
    token._close = !before || (before === 2 && Boolean(after));
    return ok(code);
  };
  return (code) => {
    marker = code;
    if (
      previous === marker &&
      events[events.length - 1][1].type !== 'characterEscape'
    ) {
      return nok(code);
    }
    effects.enter('highlightSequenceTemporary');
    return more(code);
  };
};

/**
 * Bare URLs, `https://example.com` and `www.example.com`, the way GitHub
 * links them: trailing punctuation left out, parentheses balanced, code and
 * math left alone. An email address becomes a `mailto:` link the same way.
 * The walk below has the last word on where a URL ends, see `split`.
 */
function remarkAutolinkLiteral(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(gfmAutolinkLiteral());
  (data.fromMarkdownExtensions ??= []).push(gfmAutolinkLiteralFromMarkdown());
}

/**
 * The remark plugins a note is read with, in the order they run. Math
 * first: `$…$` becomes a node without text children, so a `#` inside a
 * formula never becomes a link. Strikethrough and highlight are syntax, like
 * math; the walk then descends into a `delete` or a `mark` as into any other
 * formatting. Bare URLs come before the walk too, which takes them back apart
 * where they cut into a link.
 *
 * Exported because whoever renders a block has to read it the same way
 * `reading.ts` does to find the pages it links to, which is how a page lists
 * what links to it. Two parsers that have to agree on what a link is would be
 * one more than anyone can keep in step — a `#foo` in a code span would
 * render as text and count as a reference.
 */
export const remarkPlugins = [
  remarkMath,
  remarkStrikethrough,
  remarkAutolinkLiteral,
  remarkHighlight,
  remarkWikilink,
];

export function remarkWikilink() {
  return walk;
}

function walk(node: Root | RootContent): void {
  if (!('children' in node)) return;
  const children: RootContent[] = [];
  let run: (Text | Link)[] = [];
  for (const child of node.children) {
    if (child.type === 'text' || bare(child)) {
      run.push(child);
      continue;
    }
    children.push(...split(run), visit(child));
    run = [];
  }
  children.push(...split(run));
  node.children = children as typeof node.children;
}

function visit(child: RootContent): RootContent {
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
  const ref = child.type === 'link' && /^\(\(([^()\s]+)\)\)$/.exec(child.url);
  if (ref) return blockRef(ref[1], ...child.children);
  walk(child);
  return child;
}
