/**
 * The pages contract: types and channel names shared by main, preload and
 * renderer, and the state main sends the renderer to draw. What a page and a
 * block are, and the fold over them, are `@pbnotes/pages`. Like
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

import type { Page } from '@pbnotes/pages';
import type { LogStatus } from './log';

/**
 * The scheme an image in a note is loaded through. The page is served from a
 * dev server or a `file:` URL, neither of which can reach into a project
 * folder, so main answers `pbnotes-image://images/<name>` itself, out of the
 * project that is open.
 */
export const IMAGE_SCHEME = 'pbnotes-image';

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
  /** Main to renderer: a `PagesState`, then its number. */
  changed: 'pages:changed',
  go: 'pages:go',
  back: 'pages:back',
  rezoom: 'pages:rezoom',
  locate: 'pages:locate',
  search: 'pages:search',
  command: 'pages:command',
  addImage: 'pages:add-image',
  blockMenu: 'pages:block-menu',
  status: 'pages:status',
} as const;

/**
 * The surface exposed on `window.pbnotes.pages` by the preload bridge. No
 * call names a project: main holds which one is open, and everything here is
 * about that one.
 *
 * Nothing but `locate`, `search`, `status` and `addImage` answers with content. A write (`run`) or a step
 * along the trail resolves once `onChanged` has heard the state it led to, so
 * a caller that carries on sees it. That order is the bridge's to keep, not
 * Electron's: main numbers each state on `pages:changed`, replies with the
 * number of the one a call led to, and the preload holds the call until that
 * one has been heard (`src/preload/heard/heard.ts` says why). Writes are
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
   * The titles of the project's pages that contain `query`, ignoring case:
   * those starting with it first, then A to Z, a handful at most. What the
   * `[[` autocomplete lists (#29); #28 will search block text through it too.
   */
  search(query: string): Promise<string[]>;
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
  status(): Promise<LogStatus>;
  /**
   * Asks main to record `command`, one of the writes below (#158). One call
   * for every write, so a new write is a case on `Command`, not a channel of
   * its own. Main checks the command's shape, then runs the `@pbnotes/pages`
   * command it names, which makes the full checks and builds the event.
   */
  run(command: Command): Promise<void>;
  /**
   * Stores an image in the project's folder and returns the link a block
   * holds it by, `images/<sha256>.png`. Appends nothing: the caller puts the
   * link in a block, and that write is what the log records.
   */
  addImage(bytes: Uint8Array, mime: string): Promise<string>;
  /**
   * Pops the native menu for a block's dot at the pointer. Its one item puts
   * `((blockId))` on the clipboard. Resolves once the menu is shown, not when
   * it closes; whatever the item does happens in main.
   */
  blockMenu(blockId: string): Promise<void>;
};

/**
 * Every write the window can ask main to record, tagged by `type`. Each runs
 * exactly one command in `@pbnotes/pages`, and none says anything about what
 * is showing: where the view is, is not a write.
 *
 * A block is named by its id alone, on every case but `addBlock`: an id
 * identifies a block across the whole project, so the page is main's to look
 * up rather than the caller's to remember. That is why a view showing blocks
 * from several pages at once, like a references cut, can write to any of
 * them without tracking a title per block.
 */
export type Command =
  /**
   * Appends a `block.created` event for a block the caller has already named.
   * `id` is a fresh UUID of the caller's own: the view draws the block before
   * main has written it, so the id on screen has to be the id on disk. Main
   * refuses one that is not a UUID or that the project already has. `after`
   * puts the new block directly beneath that one; without it the block goes
   * at the end of the page.
   */
  | { type: 'addBlock'; id: string; title: string; text: string; after?: string }
  /**
   * Appends a `block.edited` event. The earlier text is not replaced on disk:
   * the log keeps both facts, and the fold shows the later one.
   */
  | { type: 'editBlock'; blockId: string; text: string }
  /**
   * Appends a `block.deleted` event. The block leaves the fold; everything
   * ever written into it stays on disk, because the log records that the user
   * deleted it, not that it never existed.
   */
  | { type: 'deleteBlock'; blockId: string }
  /**
   * Appends a `block.indented` event: the block becomes the last child of the
   * sibling above it, bringing its own children along.
   *
   * A block that is already first among its siblings has nothing to move
   * under. That resolves with nothing changed rather than throwing: the user
   * pressed a key and the outline did not change, which is not an error and
   * not a fact the log has any use for.
   */
  | { type: 'indentBlock'; blockId: string }
  /**
   * Appends a `block.outdented` event: the block comes out a level and lands
   * directly beneath the block it used to be filed under.
   *
   * The siblings that were below it come along as its children. That is the
   * only arrangement that leaves the page reading top to bottom in the order
   * it did before: leaving them behind would put them above the block that
   * just moved, which is a reordering nobody asked for.
   *
   * A block already at the top level has nothing to come out of, and resolves
   * with nothing changed rather than throwing, like `indentBlock`.
   */
  | { type: 'outdentBlock'; blockId: string };
