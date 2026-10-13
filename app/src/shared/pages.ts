/**
 * The pages contract: types and channel names shared by main, preload and
 * renderer, and the state main sends the renderer to draw. Like
 * `projects.ts`, this file is bundled into the renderer too, so it stays free
 * of `node:` imports.
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

/**
 * The scheme an image in a note is loaded through. The page is served from a
 * dev server or a `file:` URL, neither of which can reach into a project
 * folder, so main answers `pbnotes-image://images/<name>` itself, out of the
 * project that is open.
 */
export const IMAGE_SCHEME = 'pbnotes-image';

/**
 * Today as `YYYY-MM-DD`, in the user's local time. Not `toISOString()`, which
 * is UTC and hands the wrong page to anyone whose evening is already
 * tomorrow in Greenwich — or whose morning is still yesterday.
 *
 * A function in `shared` for the reason `locate` is: main puts today at the
 * top of the journal, and the renderer writes a dropped image there.
 */
export function today(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * A stop on the trail: a page, or one block of a page as the root of the
 * view. Both are places you go back to, so they share the one history.
 */
export type Place = { page: string; block?: string };

/**
 * What main has in mind for the project that is open: where the view is, and
 * everything that shows there. The renderer draws this and holds no copy of
 * its own — a write, a step along the trail and another device's notes
 * landing all reach the screen as the next one of these.
 */
export type PagesState = {
  /**
   * Where the view is, as the trail that got it there rather than one title:
   * the journal is an empty trail, and every link followed is one more on the
   * end. Back takes the last one off, so A → B → C comes back through B.
   */
  trail: Place[];
  /**
   * What is showing: the one page the trail ends on, or the journal — every
   * day with something on it, newest first, and today whether or not it has.
   * Each with what links to it, cut down to the blocks that do; none under a
   * zoom, where what links to one block is not what links to its page.
   */
  showing: { page: Page; references: Page[] }[];
  /**
   * What each `((id))` in the project shows: the id and the Markdown of that
   * block's first paragraph, or null for an id the project does not have.
   * Pairs, not an object: an id is whatever was typed between the
   * parentheses, and `((__proto__))` is a key an object does not hold.
   */
  previews: [string, string | null][];
};


export const PAGE_CHANNELS = {
  show: 'pages:show',
  changed: 'pages:changed',
  go: 'pages:go',
  back: 'pages:back',
  rezoom: 'pages:rezoom',
  locate: 'pages:locate',
  addBlock: 'pages:add-block',
  addImage: 'pages:add-image',
  editBlock: 'pages:edit-block',
  deleteBlock: 'pages:delete-block',
  indentBlock: 'pages:indent-block',
  outdentBlock: 'pages:outdent-block',
  blockMenu: 'pages:block-menu',
  status: 'pages:status',
} as const;

/**
 * The surface exposed on `window.pbnotes.pages` by the preload bridge. No
 * call names a project: main holds which one is open, and everything here is
 * about that one.
 *
 * Nothing but `locate` and `status` answers with content. A write or a step
 * along the trail resolves once main has sent the state it led to, so by the
 * time a caller carries on, `onChanged` has already heard it. Writes are
 * recorded one at a time, in the order they were sent, so one may name a
 * block an earlier one is still writing.
 */
export type PagesApi = {
  /**
   * Asks main to send what is showing, for a view that has just mounted and
   * has heard nothing yet. It arrives through `onChanged` like every other
   * state, so there is one way in and no second copy to keep in step.
   * Rejects when the project cannot be reached.
   */
  show(): Promise<void>;
  /**
   * Calls `listener` with every state main sends: after a write from this
   * window, after a step along the trail, and after another device's segment
   * lands in the folder under a sync tool. Returns an unsubscribe.
   */
  onChanged(listener: (state: PagesState) => void): () => void;
  /**
   * Follows a link: `place` goes on the end of the trail. A link to where the
   * view already is goes nowhere, and adds nothing.
   */
  go(place: Place): Promise<void>;
  /** One step back along the trail; from the first page that is the journal. */
  back(): Promise<void>;
  /**
   * The zoom moved rather than followed: the zoomed block is gone, and the
   * view lands on `block` — what it was under — or on the whole page. In
   * place of the last stop, not after it, so back does not return to a block
   * that is not there.
   */
  rezoom(block?: string): Promise<void>;
  /**
   * The page a block is on, found by its id alone — an id is unique across
   * the project. Undefined for an id the project does not have, including
   * one whose block was deleted: that is an answer, not an error.
   */
  locate(blockId: string): Promise<{ page: string } | undefined>;
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
  status(): Promise<ViewStatus>;
  /**
   * Appends a `block.created` event for a block the caller has already named.
   * `id` is a fresh UUID of the caller's own: the view draws the block before
   * main has written it, so the id on screen has to be the id on disk. Main
   * refuses one that is not a UUID or that the project already has. `after`
   * puts the new block directly beneath that one; without it the block goes
   * at the end of the page.
   */
  addBlock(
    id: string,
    title: string,
    text: string,
    after?: string,
  ): Promise<void>;
  /**
   * Stores an image in the project's folder and returns the link a block
   * holds it by, `images/<sha256>.png`. Appends nothing: the caller puts the
   * link in a block, and that write is what the log records.
   */
  addImage(bytes: Uint8Array, mime: string): Promise<string>;
  /**
   * Appends a `block.edited` event. The earlier text is not replaced on disk —
   * the log keeps both facts, and the fold shows the later one.
   *
   * No title, here or on the three below: a block id identifies a block across
   * the whole project, so the page is main's to look up rather than the
   * caller's to remember — which is why a view showing blocks from several
   * pages at once, like a references cut, can write to any of them without
   * tracking a title per block.
   */
  editBlock(blockId: string, text: string): Promise<void>;
  /**
   * Appends a `block.deleted` event. The block leaves the fold; everything
   * ever written into it stays on disk, because the log records that the user
   * deleted it, not that it never existed.
   */
  deleteBlock(blockId: string): Promise<void>;
  /**
   * Appends a `block.indented` event: the block becomes the last child of the
   * sibling above it, bringing its own children along.
   *
   * A block that is already first among its siblings has nothing to move
   * under. That resolves with nothing changed rather than throwing — the user
   * pressed a key and the outline did not change, which is not an error and
   * not a fact the log has any use for.
   */
  indentBlock(blockId: string): Promise<void>;
  /**
   * Appends a `block.outdented` event: the block comes out a level and lands
   * directly beneath the block it used to be filed under.
   *
   * The siblings that were below it come along as its children. That is the
   * only arrangement that leaves the page reading top to bottom in the order
   * it did before — leaving them behind would put them above the block that
   * just moved, which is a reordering nobody asked for.
   *
   * A block already at the top level has nothing to come out of, and resolves
   * with nothing changed rather than throwing, like `indentBlock`.
   */
  outdentBlock(blockId: string): Promise<void>;
  /**
   * Pops the native menu for a block's dot at the pointer. Its one item puts
   * `((blockId))` on the clipboard. Resolves once the menu is shown, not when
   * it closes; whatever the item does happens in main.
   */
  blockMenu(blockId: string): Promise<void>;
};
