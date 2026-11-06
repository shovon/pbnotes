/**
 * The pages kept open in the right sidebar (#287), most recently opened
 * first. Titles, by `canonicalize`, so `Mira` and `mira` are one card.
 *
 * Only opening a page reorders the stack: editing in a card never moves it,
 * so a card does not jump out from under someone writing in it.
 *
 * Pure, so it runs under `node --test`; `ProjectView` holds the stack.
 */
import { canonicalize } from '@pbnotes/graph';

/**
 * `page` was Shift+clicked: on top, wherever it was before. The same list
 * when it is on top already, so nothing downstream sees a change that is not
 * one. A page already in the stack keeps the spelling it was opened with.
 */
export function shelve(stack: readonly string[], page: string): string[] {
  const key = canonicalize(page);
  if (stack[0] !== undefined && canonicalize(stack[0]) === key) return stack as string[];
  const kept = stack.find((it) => canonicalize(it) === key) ?? page;
  return [kept, ...stack.filter((it) => canonicalize(it) !== key)];
}

/** `page`'s card was closed: off the stack. The same list when it was not on it. */
export function unshelve(stack: readonly string[], page: string): string[] {
  const key = canonicalize(page);
  const kept = stack.filter((it) => canonicalize(it) !== key);
  return kept.length === stack.length ? (stack as string[]) : kept;
}

/**
 * The page `from` is now called `to` (#109): its card reads `to`, where it
 * was in the stack, and any other card for `to` goes. The same stack when
 * `from` had no card.
 */
export function renamedIn(stack: readonly string[], from: string, to: string): string[] {
  const was = canonicalize(from);
  const now = canonicalize(to);
  const at = stack.findIndex((it) => canonicalize(it) === was);
  if (at === -1 || stack[at] === to) return stack as string[];
  return stack.flatMap((it, i) => (i === at ? [to] : canonicalize(it) === now ? [] : [it]));
}
