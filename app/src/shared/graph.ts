/**
 * The graph contract: types and channel names shared by main, preload and
 * renderer, and what main answers the renderer with to draw. What a page and a
 * block are, and the fold over them, are `@pbnotes/graph`. Like
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

import type { Page, PageListing, PageMatch, Property } from '@pbnotes/graph';
import type { LogStatus } from './log';

/**
 * The scheme an image in a note is loaded through. The page is served from a
 * dev server or a `file:` URL, neither of which can reach into a project
 * folder, so main answers `pbnotes-image://images/<name>` itself, out of the
 * project that is open.
 */
export const IMAGE_SCHEME = 'pbnotes-image';

/**
 * How big an image a copy carries inside itself (#261): up to this, its
 * bytes travel on the clipboard and a paste anywhere can store them; past
 * it, the copy carries a token main resolves to the project it came from,
 * which only this running app can follow.
 */
export const CARRY_LIMIT = 4 * 1024 * 1024;

/** How many images one paste may ask to bring. */
export const CARRY_COUNT = 1_000;

/**
 * A stop on the trail: a page, or one block of a page as the root of the
 * view. Both are places you go back to, so they share the one history. The
 * trail is the window's own (`ProjectView`); main is only ever asked what
 * shows at one place.
 */
export type Place = { page: string; block?: string };

/**
 * What shows at one place, as main read it: the answer to `view`. The
 * renderer draws this and keeps it only until a newer one arrives; it never
 * holds a fold of its own.
 */
export type PlaceView = {
  /**
   * The version of the fold this was read at (`ledgers.ts`). It holds every
   * change up to that version and none after, which is what a prediction is
   * dropped by, and what a stale answer loses by.
   */
  version: number;
  /**
   * What is showing: the one page at the place, or the journal — every day
   * with something on it, newest first, and today whether or not it has.
   * Each with what links to it, cut down to the blocks that do; none under a
   * zoom, where what links to one block is not what links to its page. And
   * each with its properties, in every mode: whether to draw them is the
   * view's. And each with its tags, and the pages that tag it, in every mode
   * but a zoom, where both are empty as `references` is. And how many times
   * the page has been deleted: a window on it that sees this go up knows it
   * was deleted, not merely emptied.
   *
   * `refsTo` is how many blocks on other pages hold a `((id))` to a block
   * on this one: what deleting it would leave showing as missing. Only on a
   * page's own view; 0 on the journal and under a zoom, where no delete is
   * offered and the walk would be paid for nothing.
   */
  showing: {
    page: Page;
    references: Page[];
    properties: Property[];
    /** The pages it points to, as `getTags` returns them. */
    tags: string[];
    /** The pages that point to it, as `getTaggedBy` returns them. */
    taggedBy: string[];
    deletions: number;
    refsTo: number;
  }[];
  /**
   * What each `((id))` in the project shows: the id and the Markdown of that
   * block's first paragraph, or null for an id the project does not have.
   * Pairs, not an object: an id is whatever was typed between the
   * parentheses, and `((__proto__))` is a key an object does not hold.
   */
  previews: [string, string | null][];
};

/** What `find` answers with: page titles, each with the page it opens, then blocks. */
export type Matches = {
  pages: PageMatch[];
  blocks: { id: string; page: string; text: string }[];
};

/**
 * Every page in the project, as the All pages view lists them (#200), and
 * the fold version they were read at, so a window keeps the newest answer.
 */
export type PageList = {
  version: number;
  pages: PageListing[];
};

export const GRAPH_CHANNELS = {
  view: 'graph:view',
  /** Main to renderer: the fold's version, and nothing else. */
  changed: 'graph:changed',
  /**
   * Main to renderer: the menu's Undo or Redo was chosen, by click or key,
   * with this window focused (#247). Carries the way, and nothing else.
   */
  take: 'graph:take',
  locate: 'graph:locate',
  search: 'graph:search',
  find: 'graph:find',
  pages: 'graph:pages',
  command: 'graph:command',
  addImage: 'graph:add-image',
  image: 'graph:image',
  imageSource: 'graph:image-source',
  carryImages: 'graph:carry-images',
  copy: 'graph:copy',
  blockMenu: 'graph:block-menu',
  pageMenu: 'graph:page-menu',
  status: 'graph:status',
} as const;

/**
 * The surface exposed on `window.pbnotes.graph` by the preload bridge. No
 * call names a project: main holds which one is open, and everything here is
 * about that one.
 *
 * Main holds the data; the window holds where it is. Every change reaches the
 * window the same way, a write from this window included: `onChanged` hears
 * the fold's new version, and the window asks `view` again for its place. A
 * write (`run`) resolves once it is recorded, with the version it led to.
 * Writes are recorded one at a time, in the order they were sent, so one may
 * name a block an earlier one is still writing.
 */
export type GraphApi = {
  /**
   * What shows at `place`, or with none the journal, read with `today` as
   * the day on top of it. `today` is the window's clock, not main's.
   * Rejects when the project cannot be reached.
   */
  view(place: Place | undefined, today: string): Promise<PlaceView>;
  /**
   * Calls `listener` with the fold's version every time it moves: a write
   * from any window, and another device's segment landing in the folder
   * under a sync tool. Returns an unsubscribe.
   */
  onChanged(listener: (version: number) => void): () => void;
  /**
   * Calls `listener` with `'undo'` or `'redo'` when the menu's Undo or Redo
   * is chosen with this window focused (#247). The window decides whether
   * the open field or main takes the step. Returns an unsubscribe.
   */
  onTake(listener: (way: 'undo' | 'redo') => void): () => void;
  /**
   * The page a block is on, found by its id alone — an id is unique across
   * the project. Undefined for an id the project does not have, including
   * one whose block was deleted: that is an answer, not an error.
   */
  locate(blockId: string): Promise<{ page: string } | undefined>;
  /**
   * The titles of the project's pages that contain `query`, ignoring case:
   * those starting with it first, then A to Z, a handful at most, each with
   * the page following it opens: another page for an alias or a date name
   * (#221). What the `[[` autocomplete lists (#29); `find` lists them for the
   * Cmd/Ctrl+K box (#28).
   */
  search(query: string): Promise<PageMatch[]>;
  /**
   * What the Cmd/Ctrl+K box lists for `query` (#28): the titles `search`
   * gives, then the blocks whose text contains it, each with the page it is
   * on and what it says with the markdown taken off.
   */
  find(query: string): Promise<Matches>;
  /**
   * Every page in the project, A to Z, journal days and pages only a link
   * or a property names included, each with how many blocks are on it, how
   * many blocks link to it and when it last changed (#200).
   */
  pages(): Promise<PageList>;
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
   * its own. Main checks the command's shape, then runs the `@pbnotes/graph`
   * command it names, which makes the full checks and builds the event.
   * Resolves once it is recorded, to the fold's version after it: a view at
   * that version or later holds it. Undo and redo resolve to an `Undone`,
   * which carries the version too.
   */
  run<C extends Command>(command: C): Promise<Reply<C>>;
  /**
   * Stores an image in the project's folder and returns the link a block
   * holds it by, `images/<sha256>.png`. Appends nothing: the caller puts the
   * link in a block, and that write is what the log records.
   */
  addImage(bytes: Uint8Array, mime: string): Promise<string>;
  /**
   * The bytes of the image a note links as `images/<name>`, and its type,
   * out of what is open: for a copy that carries the image with it (#261).
   * Undefined for one that is not there, not synced yet or never was.
   */
  image(name: string): Promise<{ bytes: Uint8Array; mime: string } | undefined>;
  /**
   * Puts `text` and `html` on the system clipboard as one copy, each for
   * whatever pastes it to take the one it reads (#261). Main writes it, as
   * it writes Copy Block Reference, so the window's focus has no say.
   */
  copy(clip: Clip): Promise<void>;
  /**
   * A token that stands for the images of what is open (#261), for a copy
   * whose images are too big to carry (`CARRY_LIMIT`). Only main can turn it
   * back into where they are, and only while it runs: nothing about the
   * project crosses the bridge. Undefined with nothing open.
   */
  imageSource(): Promise<string | undefined>;
  /**
   * Brings the images a paste links into what is open (#261), and answers
   * each one's link, in order, or undefined for one that could not be had.
   * One already there is left as it is. Otherwise its bytes, when the copy
   * carried them, are stored, or the file of that name is brought from the
   * project `source` stands for. Stored under the hash of what was stored,
   * so a link can come back other than the name asked for.
   */
  carryImages(images: readonly CarriedImage[], source?: string): Promise<(string | undefined)[]>;
  /**
   * Pops the native menu for a block at the pointer. Copy Block Reference is
   * there unless `offer` hides it, and puts `((blockId))` on the clipboard in
   * main. What else
   * it offers is `offer`'s, and what is picked from that comes back for the
   * window to do: it knows what is open and where it is, and main does not.
   * Resolves once the menu closes, to the pick, or null for anything else —
   * dismissed, or copied.
   */
  blockMenu(blockId: string, offer?: BlockMenuOffer): Promise<BlockMenuPick | null>;
  /**
   * Pops the native menu for the page on show, its top-left corner at `at`
   * in the window. Main knows nothing of which page: it draws what `offer`
   * says and answers the pick back, as `blockMenu` does. Resolves once the
   * menu closes, to the pick, or null when nothing was picked.
   */
  pageMenu(at: { x: number; y: number }, offer?: PageMenuOffer): Promise<PageMenuPick | null>;
};

/**
 * What the page menu offers. Delete Page… is always listed, so the action is
 * there to be found; it is enabled only when `delete` is true, since a page
 * with nothing on it has nothing to delete.
 */
export type PageMenuOffer = {
  delete?: boolean;
};

/** An item of the page menu the user picked. */
export type PageMenuPick = 'delete';

/** An image a paste wants: its name, and its bytes and type when the copy carried them. */
export type CarriedImage = { name: string; bytes?: Uint8Array; mime?: string };

/** One copy, in the formats it goes on the clipboard in. */
export type Clip = { text: string; html: string };

/** What a block's menu offers beyond copying its reference. */
export type BlockMenuOffer = {
  /**
   * Copy Block Reference, which is there unless this is `false`: hidden on
   * a dot among several selected (#261), where it would copy one of them.
   */
  reference?: boolean;
  /** Delete Block, which takes the block and every block under it. */
  delete?: boolean;
  /**
   * How many blocks the delete takes, when the dot is one of several
   * selected (#258): "Delete N Blocks". Left off for the block alone.
   */
  count?: number;
};

/** An item of `BlockMenuOffer` the user picked. */
export type BlockMenuPick = 'delete';

/** A block as a paste writes it: a new id, its text, and what goes under it. */
export type Pasted = { id: string; text: string; children: Pasted[] };

/**
 * Every write the window can ask main to record, tagged by `type`. Each runs
 * exactly one command in `@pbnotes/graph`, and none says anything about what
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
   * Deletes several blocks, each with its subtree, as one record and one undo
   * step (#258): a selection's top-most blocks. Main works out which of them
   * another holds, so a caller may name a block and its parent both; one the
   * project no longer has is passed over, and none left is refused.
   */
  | { type: 'deleteBlocks'; blockIds: readonly string[] }
  /**
   * Tab on a selection (#259): each top-most block filed under the sibling
   * above it, in the order given, as one record and one undo step. All or
   * nothing: when any of them is first among its siblings, on whatever page,
   * nothing moves, and that resolves rather than throws, like `indentBlock`.
   */
  | { type: 'indentBlocks'; blockIds: readonly string[] }
  /**
   * Shift+Tab on a selection (#260): each top-most block brought out a
   * level, in the order given, taking the siblings below it along as its
   * children, as one record and one undo step. All or nothing: when any of
   * them is already top-level, on whatever page, nothing moves, and that
   * resolves rather than throws, like `outdentBlock`.
   */
  | { type: 'outdentBlocks'; blockIds: readonly string[] }
  /**
   * Copied blocks written on `title` as new ones (#261), nested as they were
   * copied, as one record and one undo step. Every id is a fresh UUID of the
   * caller's, as `addBlock`'s is. `after`, `parent` and `first` place the
   * first block as they place a new one, and each next one goes directly
   * beneath the one before; or `into` names an empty block on the page,
   * which the first pasted block replaces, keeping its id.
   */
  | {
      type: 'pasteBlocks';
      title: string;
      blocks: readonly Pasted[];
      after?: string;
      parent?: string;
      first?: true;
      into?: string;
    }
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
  | { type: 'outdentBlock'; blockId: string }
  /**
   * Appends a `block.moved` event (#251): the block, with everything under
   * it, goes to `title`, on its own page or another, keeping its id.
   * `after`, `parent` and `first` place it as they place a new block. A page
   * nothing was written on yet takes it like any other: every page is in
   * the graph, and this is only the first write to it.
   *
   * Main refuses a place inside the block's own subtree, and a place the
   * page lacks. A block already where the move puts it resolves with
   * nothing written, like `indentBlock` with nowhere to go.
   */
  | {
      type: 'moveBlock';
      blockId: string;
      title: string;
      after?: string;
      parent?: string;
      first?: true;
    }
  /**
   * Appends a `property.set` event: `title`'s `key` is now `value`. A key is
   * a page title, so it arrives trimmed like one. Setting the value the key
   * already has resolves with nothing written.
   */
  | { type: 'setProperty'; title: string; key: string; value: string }
  /**
   * Appends a `property.removed` event. Removing a key the page does not
   * have resolves with nothing written.
   */
  | { type: 'removeProperty'; title: string; key: string }
  /**
   * `title`'s `from` becomes `to`, keeping its value: appends one `batch` of
   * a `property.set` of `to` and a `property.removed` of `from`, so the
   * rename lands whole or not at all (#225). Main refuses a `to` the page
   * already has, rather than overwrite it, and a `from` it does not have.
   */
  | { type: 'renameProperty'; title: string; from: string; to: string }
  /**
   * Appends a `tag.added` event: `title` now points to `tag`. A tag is a page
   * title, so it arrives trimmed like one. A tag the page already has
   * resolves with nothing written.
   */
  | { type: 'addTag'; title: string; tag: string }
  /**
   * Appends a `tag.removed` event. Removing a tag the page does not have
   * resolves with nothing written.
   */
  | { type: 'removeTag'; title: string; tag: string }
  /**
   * Appends a `page.deleted` event: the page's blocks, properties and tags are
   * gone from the fold, and stay on disk. A page with nothing on it resolves
   * with nothing written, since the delete would change nothing.
   */
  | { type: 'deletePage'; title: string }
  /**
   * Takes back the latest step this session wrote in the open project (#234):
   * the events that undo it, written as one batch. Stops, writing nothing,
   * when someone else has changed what the step touched since, or when it
   * cannot be undone; it never skips a step to reach an older one. Resolves
   * to an `Undone`, not a bare version.
   */
  | { type: 'undo' }
  /** Takes back the latest undo, by the same rules (#234). Resolves to an `Undone`. */
  | { type: 'redo' };

/** The commands that take a step back, and answer with an `Undone`. */
export type Taking = Extract<Command, { type: 'undo' | 'redo' }>;

/**
 * What an undo or a redo did (#234), with the fold's version after it, as
 * every write's reply carries.
 *
 * - `done`: the step was taken back.
 * - `nothing`: there was nothing to undo, or to redo. Nothing was written.
 * - `changed`: undo stopped, because someone else changed what the step
 *   touched since. Nothing was written, and it stops there again until that
 *   change goes away.
 * - `cannot`: undo stopped, because the step cannot be undone at all.
 *   Nothing was written.
 *
 * `page` and `block` are where the step happened, for the window to go to,
 * with every result but `nothing`. `block` is absent for a step that is
 * about a page as a whole (a property, a tag, a page delete).
 */
export type Undone = {
  version: number;
  result: 'done' | 'nothing' | 'changed' | 'cannot';
  page?: string;
  block?: string;
};

/** What `run` resolves to for `command`: an `Undone` for undo and redo, else the version. */
export type Reply<C extends Command> = C extends Taking ? Undone : number;
