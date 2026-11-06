/**
 * Reads over the folded blocks. Each takes the state alone, since none of
 * them writes.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { DATE_PATTERN } from "../journal/journal.ts";
import { read } from "../reading/reading.ts";
import { spelled, titleOf } from "../titles/titles.ts";
import * as forest from "../forest/forest.ts";
import * as map from "../immutable/immutable.ts";
import { blocksOn, find, pageBlocks, textOf, treeOf } from "./blocks.ts";
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
  return journalKeys(state).map((key) => ({ title: spelled(state.titles, key), blocks: pageBlocks(state, key) }));
}

/**
 * The journal's days, as `getPages` has them, without their blocks: what a
 * caller reads to pick which days to show before it builds any (#282).
 */
export function getDays(state: BlockState): string[] {
  return journalKeys(state).map((key) => spelled(state.titles, key));
}

/** Every day with something on it, by key, newest first. */
function journalKeys(state: BlockState): string[] {
  return [...forest.groups(state.forest)]
    .filter((key) => forest.rootsOf(state.forest, key).length > 0 && DATE_PATTERN.test(key))
    .sort((a, b) => b.localeCompare(a));
}

/** Every page that has had blocks, by key, with its blocks' ids depth first. */
function* pagesOf(state: BlockState): Generator<[string, string[]]> {
  for (const key of forest.groups(state.forest)) yield [key, forest.inGroup(state.forest, key)];
}

/** A block's text: `""` for one that is gone, which a caller walking the forest never asks for. */
const textAt = (state: BlockState, id: string) => textOf(state, id) ?? "";

/**
 * The blocks that link to `title`, in whatever case the link was written,
 * each with its subtree. A block that links is taken whole and not searched
 * inside: its children are already on show under it.
 */
export function linking(blocks: Block[], title: string): Block[] {
  return linkingAny(blocks, new Set([canonicalize(title)]));
}

/** `linking`, for a link to any of `keys` (each `canonicalize`d). */
function linkingAny(blocks: Block[], keys: ReadonlySet<string>): Block[] {
  return blocks.flatMap((block) =>
    links(block.text, keys) ? [block] : linkingAny(block.children, keys),
  );
}

/** Whether `text` links to any of `keys` (each `canonicalize`d). */
function links(text: string, keys: ReadonlySet<string>): boolean {
  return read(text).links.some((link) => keys.has(canonicalize(link)));
}

/** `linkingAny` over the blocks `ids` in the state, building a tree only for each that links. */
function linkingIn(state: BlockState, ids: readonly string[], keys: ReadonlySet<string>): Block[] {
  return ids.flatMap((id) =>
    links(textAt(state, id), keys)
      ? [treeOf(state, id)!]
      : linkingIn(state, forest.childrenOf(state.forest, id), keys),
  );
}

/**
 * What links to a page, grouped by the page it was written on and cut down to
 * the blocks that do the linking. A page is not a reference to itself.
 * `also`: other names a link may use for it, as an alias does (#221).
 *
 * Pages in the order they are listed (`shownOrder`).
 *
 * ponytail: one call per page shown. Fold this into a single reverse index if
 * a ledger ever has enough days for that to show.
 */
export function getReferences(
  state: BlockState,
  title: string,
  also: Iterable<string> = [],
): Page[] {
  const key = canonicalize(title);
  const keys = new Set([key, ...[...also].map(canonicalize)]);
  return [...forest.groups(state.forest)]
    .filter((page) => page !== key)
    .map((page) => ({
      title: spelled(state.titles, page),
      blocks: linkingIn(state, forest.rootsOf(state.forest, page), keys),
    }))
    .filter((page) => page.blocks.length > 0)
    .sort((a, b) => shownOrder(a.title, b.title));
}

/**
 * The order pages are listed in: journal days first, newest first, then
 * named pages A to Z. Days are told apart before anything is compared, so a
 * page called `1984` does not land among them.
 */
function shownOrder(a: string, b: string): number {
  const days = [a, b].map((title) => DATE_PATTERN.test(title));
  if (days[0] !== days[1]) return days[0] ? -1 : 1;
  return days[0] ? b.localeCompare(a) : a.localeCompare(b);
}

/** A block whose text matched: its id, the page it is on, and what it says. */
export type BlockMatch = { id: string; page: string; text: string };

/**
 * The blocks whose text contains `query`, ignoring case, at most `limit`.
 * Matched against what a block says with the markdown taken off (`plain`
 * in `read`), so link syntax and formatting marks match nothing. Pages in
 * the order they are listed (`shownOrder`), and blocks in tree order on
 * each, children after their parent. Nothing for a blank query.
 *
 * ponytail: walks every block per call, with `read` memoised. An index if a
 * ledger ever gets big enough for that to show.
 */
export function searchBlocks(state: BlockState, query: string, limit = 20): BlockMatch[] {
  const q = canonicalize(query);
  if (!q) return [];
  const pages = [...pagesOf(state)]
    .map(([key, ids]) => ({ title: spelled(state.titles, key), ids }))
    .sort((a, b) => shownOrder(a.title, b.title));
  const found: BlockMatch[] = [];
  for (const page of pages) {
    for (const id of page.ids) {
      const text = read(textAt(state, id)).plain;
      if (!canonicalize(text).includes(q)) continue;
      found.push({ id, page: page.title, text });
      if (found.length === limit) return found;
    }
  }
  return found;
}

/**
 * Every block the pages refer to with `((id))`, and what a ref to it shows:
 * the target's first paragraph, or null for an id the ledger lacks.
 *
 * Given `pages`, only the refs on them (#282), and the refs in what those
 * show, and so on, so whoever swaps a ref for its preview can swap the refs
 * inside it too. Without, every ref in the project.
 *
 * Pairs, not an object: an id is whatever was typed, and `((__proto__))` is a
 * key an object does not hold.
 */
export function getPreviews(state: BlockState, pages?: readonly Page[]): [string, string | null][] {
  const previews = new Map<string, string | null>();
  const quote = (text: string) => {
    for (const id of read(text).refs) {
      if (previews.has(id)) continue;
      const target = textOf(state, id);
      const preview = target === undefined ? null : read(target).preview;
      previews.set(id, preview);
      if (pages && preview) quote(preview);
    }
  };
  if (pages) {
    const walk = (blocks: readonly Block[]) => blocks.forEach((block) => (quote(block.text), walk(block.children)));
    pages.forEach((page) => walk(page.blocks));
  } else {
    for (const text of map.values(state.texts)) quote(text);
  }
  return [...previews].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
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
  for (const [key, ids] of pagesOf(state)) {
    if (ids.length > 0) yield key;
    for (const id of ids) yield* read(textAt(state, id)).links;
  }
}

/**
 * How many blocks link to each page by title, by `canonicalize`: what each
 * page's references list, counted in one pass. A linking block counts once,
 * and its children are not counted again for the same page, as `linking`
 * takes it whole. A page is not a reference to itself.
 *
 * `to` takes a link's key to the key of the page it counts for, as resolving
 * an alias does (#221); a block linking two names of one page counts once.
 */
export function countLinks(
  state: BlockState,
  to: (key: string) => string = (key) => key,
): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (ids: readonly string[], skip: ReadonlySet<string>) => {
    for (const id of ids) {
      const fresh = new Set(
        read(textAt(state, id)).links.map((link) => to(canonicalize(link))).filter((key) => !skip.has(key)),
      );
      for (const key of fresh) counts.set(key, (counts.get(key) ?? 0) + 1);
      walk(forest.childrenOf(state.forest, id), fresh.size === 0 ? skip : new Set([...skip, ...fresh]));
    }
  };
  for (const key of forest.groups(state.forest)) walk(forest.rootsOf(state.forest, key), new Set([to(key)]));
  return counts;
}

/** How many blocks are on `page`, at every depth. */
export function countBlocks(state: BlockState, page: string): number {
  return forest.inGroup(state.forest, canonicalize(page)).length;
}

/** The page a block is on, or undefined for a block the ledger lacks. */
export function locateBlock(state: BlockState, blockId: string): { page: string } | undefined {
  const found = find(state, blockId);
  return found && { page: found.page };
}
