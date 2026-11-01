/**
 * Reads over the folded blocks. Each takes the state alone, since none of
 * them writes.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { DATE_PATTERN } from "../journal/journal.ts";
import { read } from "../reading/reading.ts";
import { titleOf } from "../titles/titles.ts";
import { blocksOn, find } from "./blocks.ts";
import type { Block, BlockState, Page } from "./blocks.ts";

/** A page as it stands, under the spelling it shows, empty if nothing is on it. */
export function getPage(state: BlockState, title: string): Page {
  return { title: titleOf(state, title), blocks: blocksOn(state, title) };
}

/**
 * The journal: every day that has something on it, newest first. A day whose
 * only block was deleted is left out. Today is not added: which day that is
 * depends on the clock, and a caller that shows a journal puts it at the top
 * itself.
 */
export function getPages(state: BlockState): Page[] {
  return [...state.blocks]
    .filter(([key, blocks]) => blocks.length > 0 && DATE_PATTERN.test(key))
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, blocks]) => ({ title: state.titles.get(key) ?? key, blocks }));
}

/** Every block in a tree, depth first. */
function* every(blocks: Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    yield* every(block.children);
  }
}

/**
 * The blocks that link to `title`, in whatever case the link was written,
 * each with its subtree. A block that links is taken whole and not searched
 * inside: its children are already on show under it.
 */
export function linking(blocks: Block[], title: string): Block[] {
  const key = canonicalize(title);
  return blocks.flatMap((block) =>
    read(block.text).links.some((link) => canonicalize(link) === key)
      ? [block]
      : linking(block.children, title),
  );
}

/**
 * What links to a page, grouped by the page it was written on and cut down to
 * the blocks that do the linking. A page is not a reference to itself.
 *
 * Journal days first, newest first, then named pages A to Z. Days are told
 * apart before anything is compared, so a page called `1984` does not land
 * among them.
 *
 * ponytail: one call per page shown. Fold this into a single reverse index if
 * a ledger ever has enough days for that to show.
 */
export function getReferences(state: BlockState, title: string): Page[] {
  const key = canonicalize(title);
  return [...state.blocks]
    .filter(([page]) => page !== key)
    .map(([page, on]) => ({ title: state.titles.get(page) ?? page, blocks: linking(on, title) }))
    .filter((page) => page.blocks.length > 0)
    .sort((a, b) => {
      const days = [a, b].map((page) => DATE_PATTERN.test(page.title));
      if (days[0] !== days[1]) return days[0] ? -1 : 1;
      return days[0] ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title);
    });
}

/**
 * Every block the pages refer to with `((id))`, and what a ref to it shows:
 * the target's first paragraph, or null for an id the ledger lacks.
 *
 * Pairs, not an object: an id is whatever was typed, and `((__proto__))` is a
 * key an object does not hold.
 */
export function getPreviews(state: BlockState): [string, string | null][] {
  const ids = new Set<string>();
  for (const blocks of state.blocks.values()) {
    for (const block of every(blocks)) read(block.text).refs.forEach((id) => ids.add(id));
  }
  return [...ids].map((id) => {
    const found = find(state, id);
    return [id, found ? read(found.siblings[found.at].text).preview : null];
  });
}

/**
 * Every title the blocks name: each page with blocks on it, and each page a
 * block's current text links to. Walks the blocks rather than `titles`, so a
 * typo linked once and fixed is not named forever.
 *
 * ponytail: walks every block per call, with `read` memoised. Keep a title set
 * in the fold if a ledger ever gets big enough for that to show.
 */
export function* named(state: BlockState): Generator<string> {
  for (const [key, blocks] of state.blocks) {
    if (blocks.length > 0) yield key;
    for (const block of every(blocks)) yield* read(block.text).links;
  }
}

/** The page a block is on, or undefined for a block the ledger lacks. */
export function locateBlock(state: BlockState, blockId: string): { page: string } | undefined {
  const found = find(state, blockId);
  return found && { page: found.page };
}
