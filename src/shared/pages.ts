/**
 * The pages contract: types and channel names shared by main, preload and
 * renderer. Like `projects.ts`, this file is bundled into the renderer too, so
 * it stays free of `node:` imports.
 *
 * A page *is* its title. Its contents are whatever blocks carry that title —
 * there is no page record anywhere, so a page is never created: naming one,
 * in a link or by the calendar, is all it takes for it to exist. A journal day
 * is the page titled with its local date in `YYYY-MM-DD`; `[[Mira]]`, `#Mira`
 * and `#[[Mira]]` all name the page `Mira`. Opening a page that has never been
 * written to yields an empty page in memory and appends nothing: the log
 * records what the user did, and looking at a page is not something they did.
 */

import type { ViewStatus } from './log';

export type Block = {
  id: string;
  text: string;
  /** Nested beneath this one, in the order they fold. Empty for a leaf. */
  children: Block[];
};

/**
 * Where a block sits: the array it is in, its index in that array, and the
 * block it hangs under. Undefined `parent` means the top level of the page.
 *
 * A function in `shared`, against the convention that this file holds types
 * and constants. It is here because both sides genuinely need it — main to
 * find the sibling an indent moves a block under, the renderer to work out
 * where a caret goes — and two copies of one tree walk that have to agree is
 * exactly the drift `projection.ts` warns about. Pure, no `node:` imports, so
 * the reason the convention exists still holds.
 */
export function locate(
  blocks: Block[],
  id: string,
  parent?: Block,
): { siblings: Block[]; at: number; parent?: Block } | undefined {
  const at = blocks.findIndex((block) => block.id === id);
  if (at !== -1) return { siblings: blocks, at, parent };
  for (const block of blocks) {
    const hit = locate(block.children, id, block);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The deepest last descendant — the block that renders directly above
 * whatever comes after this one's subtree. Itself, for a leaf.
 */
export function lastLeaf(block: Block): Block {
  let last = block;
  while (last.children.length > 0) {
    last = last.children[last.children.length - 1];
  }
  return last;
}

export type Page = {
  /**
   * What names the page: a local `YYYY-MM-DD` for a journal day, otherwise
   * whatever a link called it, exactly as typed. Case matters — `#Mira` and
   * `#mira` are two pages — because the title is a key in a log that keeps
   * everything forever, and folding case together later is a choice the fold
   * can make; lowercasing now would lose the casing for good.
   */
  title: string;
  /** In the order they belong on the page, which is the order they fold. */
  blocks: Block[];
};

/**
 * What makes a title a journal day. The renderer picks the day, so main never
 * has to hold an opinion about the user's timezone; main uses this only to
 * tell the journal apart from the pages that links name.
 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const PAGE_CHANNELS = {
  open: 'pages:open',
  openAll: 'pages:open-all',
  addBlock: 'pages:add-block',
  editBlock: 'pages:edit-block',
  deleteBlock: 'pages:delete-block',
  indentBlock: 'pages:indent-block',
  outdentBlock: 'pages:outdent-block',
  status: 'pages:status',
} as const;

/** The surface exposed on `window.gnotes.pages` by the preload bridge. */
export type PagesApi = {
  /** The page with that title, empty if nothing has been written to it yet. */
  open(projectId: string, title: string): Promise<Page>;
  /**
   * The journal: every day that has blocks on it, newest first — the default
   * view of a project, which is all of its days stacked rather than one of
   * them. Pages that links name are not days and are not in it; they are
   * reached through `open`.
   *
   * Days that fold to nothing are not in it, and neither is today unless
   * something has been written there: main does not know which day today is,
   * so the view puts it at the top itself.
   */
  openAll(projectId: string): Promise<Page[]>;
  /**
   * How much of the project's log folder could be read, and what the fold
   * could not use.
   *
   * The folder is shared with whatever sync tool the user pointed at it, so a
   * device that is still arriving, a file that is only a placeholder, and a
   * note written by a newer build are all ordinary states rather than errors.
   * They must be visible all the same: skipping something without a word is
   * how a single-writer log loses a machine's notes silently.
   */
  status(projectId: string): Promise<ViewStatus>;
  /**
   * Appends a `block.created` event and returns the page it folded into.
   * `after` puts the new block directly beneath that one; without it the block
   * goes at the end of the page.
   */
  addBlock(
    projectId: string,
    title: string,
    text: string,
    after?: string,
  ): Promise<Page>;
  /**
   * Appends a `block.edited` event. The earlier text is not replaced on disk —
   * the log keeps both facts, and the fold shows the later one.
   */
  editBlock(
    projectId: string,
    title: string,
    blockId: string,
    text: string,
  ): Promise<Page>;
  /**
   * Appends a `block.deleted` event. The block leaves the fold; everything
   * ever written into it stays on disk, because the log records that the user
   * deleted it, not that it never existed.
   */
  deleteBlock(
    projectId: string,
    title: string,
    blockId: string,
  ): Promise<Page>;
  /**
   * Appends a `block.indented` event: the block becomes the last child of the
   * sibling above it, bringing its own children along.
   *
   * A block that is already first among its siblings has nothing to move
   * under. That returns the page untouched rather than throwing — the user
   * pressed a key and the outline did not change, which is not an error and
   * not a fact the log has any use for.
   */
  indentBlock(
    projectId: string,
    title: string,
    blockId: string,
  ): Promise<Page>;
  /**
   * Appends a `block.outdented` event: the block comes out a level and lands
   * directly beneath the block it used to be filed under.
   *
   * The siblings that were below it come along as its children. That is the
   * only arrangement that leaves the page reading top to bottom in the order
   * it did before — leaving them behind would put them above the block that
   * just moved, which is a reordering nobody asked for.
   *
   * A block already at the top level has nothing to come out of, and returns
   * the page untouched rather than throwing, like `indentBlock`.
   */
  outdentBlock(
    projectId: string,
    title: string,
    blockId: string,
  ): Promise<Page>;
};
