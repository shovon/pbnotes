/**
 * The pages contract: types and channel names shared by main, preload and
 * renderer. Like `projects.ts`, this file is bundled into the renderer too, so
 * it stays free of `node:` imports.
 *
 * A page *is* a day. Its id is a local calendar date in `YYYY-MM-DD`, and its
 * contents are whatever blocks carry that date — there is no page record
 * anywhere. Opening a day that has never been written to yields an empty page
 * in memory and appends nothing: the log records what the user did, and
 * looking at today is not something they did.
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
  /** `YYYY-MM-DD`, in the user's local time. */
  date: string;
  /** In the order they belong on the page, which is the order they fold. */
  blocks: Block[];
};

/**
 * The renderer picks the day, so main never has to hold an opinion about the
 * user's timezone. Checked on arrival all the same: the date is a key in an
 * append-only log, and a malformed one is there forever.
 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const PAGE_CHANNELS = {
  open: 'pages:open',
  addBlock: 'pages:add-block',
  editBlock: 'pages:edit-block',
  deleteBlock: 'pages:delete-block',
  indentBlock: 'pages:indent-block',
  outdentBlock: 'pages:outdent-block',
  status: 'pages:status',
} as const;

/** The surface exposed on `window.gnotes.pages` by the preload bridge. */
export type PagesApi = {
  /** The day's page, empty if nothing has been written to it yet. */
  open(projectId: string, date: string): Promise<Page>;
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
   * goes at the end of the day.
   */
  addBlock(
    projectId: string,
    date: string,
    text: string,
    after?: string,
  ): Promise<Page>;
  /**
   * Appends a `block.edited` event. The earlier text is not replaced on disk —
   * the log keeps both facts, and the fold shows the later one.
   */
  editBlock(
    projectId: string,
    date: string,
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
    date: string,
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
    date: string,
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
    date: string,
    blockId: string,
  ): Promise<Page>;
};
