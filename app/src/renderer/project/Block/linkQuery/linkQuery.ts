/**
 * The `[[` the caret is completing, if any, and what picking a page does to
 * it. Kept apart from the textarea, like `brackets`, so the rules can be
 * tested without a DOM.
 */
import { inCode } from '@pbnotes/pages';
import type { Edit } from '../brackets/brackets';

/**
 * Where the `[[` starts, what is typed between it and the caret, and whether
 * it is the target of an alias, `[label]([[`.
 */
export type LinkQuery = { at: number; query: string; alias: boolean };

/**
 * The nearest `[[` before the caret, unless a bracket or a newline has been
 * typed since, which means the caret has left it, or it is in code.
 */
export function linkQuery(value: string, caret: number): LinkQuery | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('[[');
  if (at === -1) return null;
  const query = before.slice(at + 2);
  if (/[[\]\n]/.test(query) || inCode(value, at)) return null;
  return { at, query, alias: /\[[^[\]]*\]\($/.test(before.slice(0, at)) };
}

/**
 * The query becomes `title` and the link is closed, taking over whatever of
 * the closing brackets is already there: `[[` puts `]]` after the caret as it
 * is typed, and nobody wants `[[Foo]]]]`.
 */
export function completeLink(
  value: string,
  caret: number,
  { at, alias }: LinkQuery,
  title: string,
): Edit {
  const close = alias ? ']])' : ']]';
  let taken = close.length;
  while (!value.startsWith(close.slice(0, taken), caret)) taken--;
  const end = at + 2 + title.length + close.length;
  return { from: at + 2, to: caret + taken, text: title + close, select: [end, end] };
}
