/**
 * What the chip row's input does with what is typed in it: the rules, apart
 * from the component, so they run under `node --test`.
 *
 * Tags compare through `canonicalize`, as the fold compares them, so a tag
 * held as `Work` is held whatever case or spacing ` work ` is typed in.
 */
import { canonicalize } from '@pbnotes/graph';

const same = (a: string, b: string): boolean => canonicalize(a) === canonicalize(b);

/**
 * What Enter on `typed` asks for, over the tags as drawn:
 * - `blank`: nothing typed, once trimmed. Nothing is written.
 * - `held`: a tag the page has. Nothing is written; `tag` is the chip, as
 *   drawn, to point at.
 * - `add`: a new tag, trimmed, as main's checker wants a title.
 */
export type Adding =
  | { kind: 'blank' }
  | { kind: 'held'; tag: string }
  | { kind: 'add'; tag: string };

export function adding(tags: readonly string[], typed: string): Adding {
  const tag = typed.trim();
  if (tag === '') return { kind: 'blank' };
  const held = tags.find((it) => same(it, tag));
  return held === undefined ? { kind: 'add', tag } : { kind: 'held', tag: held };
}

/** Which of the titles `found` to offer: not a tag the page has, which would add nothing. */
export function offered(
  found: readonly string[],
  tags: readonly string[],
): string[] {
  return found.filter((title) => !tags.some((tag) => same(tag, title)));
}
