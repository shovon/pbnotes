/**
 * What the alias row's input does with what is typed in it, and the words it
 * says about an alias (#383): the rules, apart from the component, so they
 * run under `node --test`.
 *
 * Aliases compare through `canonicalize`, as the fold compares them, so an
 * alias held as `JS` is held whatever case or spacing ` js ` is typed in.
 */
import { DATE_PATTERN, canonicalize } from '@pbnotes/graph';
import type { HeldAlias, Inert } from '@pbnotes/graph';

const same = (a: string, b: string): boolean => canonicalize(a) === canonicalize(b);

/**
 * What Enter on `typed` asks for, over the aliases as drawn and the page's
 * title:
 * - `blank`: nothing typed, once trimmed. Nothing is written.
 * - `self`: the page's own title. Nothing is written.
 * - `date`: a `YYYY-MM-DD`, which always opens its day. Nothing is written.
 * - `held`: an alias the page has. Nothing is written; `alias` is the chip,
 *   as drawn, to point at.
 * - `add`: a new alias, trimmed, as main's checker wants a title.
 */
export type Adding =
  | { kind: 'blank' }
  | { kind: 'self' }
  | { kind: 'date' }
  | { kind: 'held'; alias: string }
  | { kind: 'add'; alias: string };

export function adding(aliases: readonly string[], title: string, typed: string): Adding {
  const alias = typed.trim();
  if (alias === '') return { kind: 'blank' };
  if (same(alias, title)) return { kind: 'self' };
  if (DATE_PATTERN.test(canonicalize(alias))) return { kind: 'date' };
  const held = aliases.find((it) => same(it, alias));
  return held === undefined ? { kind: 'add', alias } : { kind: 'held', alias: held };
}

/** What the input says about a name it will not add. */
export function refusal(kind: 'self' | 'date', alias: string): string {
  return kind === 'self'
    ? `This page is already called ${alias}`
    : `${alias} is a date, so it always opens its day`;
}

/**
 * Why `alias` does nothing, in the words the input's hint and a dimmed
 * chip's tooltip both use, so an alias that does nothing never does it
 * silently.
 */
export function told(alias: string, inert: Inert): string {
  switch (inert.why) {
    case 'self':
      return `${alias} is this page's own title`;
    case 'own':
      return `${alias} has notes of its own, so it opens itself`;
    case 'day':
      return `${alias} is a date, so it opens ${inert.day}`;
    case 'date':
      return `${alias} is a date, so it always opens its day`;
    case 'aliases':
      return `${alias} has aliases of its own, so it opens itself`;
    case 'claimed':
      return `${inert.by} also claims ${alias}, and opens it`;
  }
}

/**
 * The chips as drawn: `names`, main's aliases with this view's writes in
 * flight over them, each with why it is inert as main last said. A name main
 * has not answered for yet is drawn in effect until it does.
 */
export function drawn(names: readonly string[], held: readonly HeldAlias[]): HeldAlias[] {
  const by = new Map(held.map((it) => [canonicalize(it.alias), it.inert] as const));
  return names.map((alias) => {
    const inert = by.get(canonicalize(alias));
    return inert === undefined ? { alias } : { alias, inert };
  });
}
