/**
 * The link the caret is completing, if any, and what picking a page does to
 * it: a `[[` (#29) or a `#` (#365), which name a page the same way. Kept
 * apart from the textarea, like `brackets`, so the rules can be tested
 * without a DOM.
 */
import { bareTag, inCode } from '@pbnotes/graph';
import type { Edit } from '../brackets/brackets';

/**
 * Where the link starts, what is typed between its opening and the caret, and
 * how it is written, as `matchFrom` names the forms:
 *
 * - `brackets`: `[[`, and `#[[` too, whose `#` the completion leaves alone.
 * - `alias`: the target of an alias, `[label]([[`.
 * - `tag`: a bare `#`.
 */
export type LinkQuery = { at: number; query: string; form: 'brackets' | 'alias' | 'tag' };

/** What a bare tag may hold, as the parser in `wikilink.ts` reads one. */
const TAG_CHAR = /[\p{L}\p{N}_/-]/u;
const TAG_AHEAD = /^[\p{L}\p{N}_/-]*/u;
/** What may not stand before a `#` that starts a tag: mid-word, `##`, `/#`. */
const NOT_BEFORE = /[\p{L}\p{N}/#]$/u;

/**
 * The open `[[` before the caret, else the `#` the caret is typing a tag
 * after; neither in code. An open `[[` comes first: a `#` inside one is part
 * of the page's name.
 */
export function linkQuery(value: string, caret: number): LinkQuery | null {
  const before = value.slice(0, caret);
  return brackets(value, before) ?? tag(value, before);
}

/**
 * The nearest `[[`, unless a bracket or a newline has been typed since,
 * which means the caret has left it.
 */
function brackets(value: string, before: string): LinkQuery | null {
  const at = before.lastIndexOf('[[');
  if (at === -1) return null;
  const query = before.slice(at + 2);
  if (/[[\]\n]/.test(query) || inCode(value, at)) return null;
  const alias = /\[[^[\]]*\]\($/.test(before.slice(0, at));
  return { at, query, form: alias ? 'alias' : 'brackets' };
}

/**
 * The `#` just before a run of what a tag may hold that ends at the caret.
 * Anything else typed — a space, punctuation, a newline — ends the run, and
 * with it the list.
 */
function tag(value: string, before: string): LinkQuery | null {
  /* Walked back a code point at a time rather than matched with `…*$`,
     which retries from every letter of a long run. */
  let at = before.length;
  for (const char of [...before].reverse()) {
    if (!TAG_CHAR.test(char)) break;
    at -= char.length;
  }
  if (before[--at] !== '#') return null;
  const query = before.slice(at + 1);
  if (NOT_BEFORE.test(before.slice(0, at)) || inCode(value, at)) return null;
  return { at, query, form: 'tag' };
}

/**
 * The query becomes `title` and the link is closed, taking over whatever of
 * the closing brackets is already there: `[[` puts `]]` after the caret as it
 * is typed, and nobody wants `[[Foo]]]]`.
 *
 * A tag stays bare when the title reads as one whole, and takes brackets
 * when it does not — `#[[Foo Page]]`. It takes over the rest of the word the
 * caret is in, so picking `Foo` in `#Fo|o` is `#Foo`, not `#Fooo`.
 */
export function completeLink(
  value: string,
  caret: number,
  { at, form }: LinkQuery,
  title: string,
): Edit {
  if (form === 'tag') {
    const text = bareTag(title) ? title : `[[${title}]]`;
    const to = caret + (TAG_AHEAD.exec(value.slice(caret))?.[0].length ?? 0);
    const end = at + 1 + text.length;
    return { from: at + 1, to, text, select: [end, end] };
  }
  const close = form === 'alias' ? ']])' : ']]';
  let taken = close.length;
  while (!value.startsWith(close.slice(0, taken), caret)) taken--;
  const end = at + 2 + title.length + close.length;
  return { from: at + 2, to: caret + taken, text: title + close, select: [end, end] };
}
