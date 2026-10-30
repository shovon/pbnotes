/**
 * Marks drawn over a block's words: `~~struck~~`, `==highlighted==` and
 * `^^highlighted^^`. Rendering only — nothing in `@pbnotes/pages` reads
 * them, so they ride alongside its plugins here instead of inside them.
 */
import type { RootContent } from 'mdast';
import type { Processor } from 'unified';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
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
 * `~~foo~~`, and only that piece of GFM: `remark-gfm` would also bring
 * tables, task lists, footnotes and bare-URL autolinks, each of which changes
 * how existing notes look. A single `~` stays text, so `~5 min` is safe.
 * Rendering needs nothing more — the `delete` node already becomes `<del>`.
 */
export function remarkStrikethrough(this: Processor) {
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
export function remarkHighlight(this: Processor) {
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
