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

export type Block = {
  id: string;
  text: string;
};

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
} as const;

/** The surface exposed on `window.gnotes.pages` by the preload bridge. */
export type PagesApi = {
  /** The day's page, empty if nothing has been written to it yet. */
  open(projectId: string, date: string): Promise<Page>;
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
};
