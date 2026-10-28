/**
 * The pages of what is open, as one window session sees them: where the view
 * is along the trail, what is sent to the windows and when, and the order the
 * writes are recorded in.
 *
 * Free of `electron` imports, so it runs under `node --test`; `pages-ipc.ts`
 * is only the channels in front of it, and the windows `broadcast` sends to.
 */
import {
  addBlock,
  deleteBlock,
  editBlock,
  indentBlock,
  locateBlock,
  outdentBlock,
  searchPages,
  today,
} from "@pbnotes/pages";
import type { PagesState, Place } from "../../../../../shared/pages.ts";
import type { LogStatus } from "../../../../../shared/log.ts";
import { getLogStatus, getState } from "../pages-store/pages-store.ts";
import type { PagesView } from "../pages-store/pages-store.ts";
import { back, go, rezoom } from "../trail/trail.ts";

/**
 * What is open, as whoever makes this hands it over: the pages of it, and
 * the images kept beside them. Pages are told nothing else — not what decides
 * what is open, not what it is, and not where it is kept.
 *
 * `require` is the one to read and write through. It refuses what cannot be
 * reached — opening a ledger creates its directory, and that must not happen
 * on a drive that is not there — and it settles what is open before its
 * first `await`, so a write calls it first: a write sent just before that
 * changed still lands where it was typed. `saveImage` settles it the same
 * way.
 *
 * `findImage` only reads, and opens nothing: with nothing open, or a drive
 * that is not there, it finds nothing.
 */
export type Open = {
  require(): Promise<PagesView>;
  /** Stores an image and returns what a note links it by. */
  saveImage(bytes: Uint8Array, mime: string): Promise<string>;
  /** The file a note's `images/<name>` is, or undefined. */
  findImage(name: string): Promise<string | undefined>;
};

/**
 * `now` is the clock that decides which day is today, and `broadcast` sends a
 * state to every window; both are handed in like everything else this reads
 * or reaches from outside. The trail and the two queues live in here, one set
 * per call.
 */
export function createPagesSession(
  open: Open,
  now: () => Date,
  broadcast: (state: PagesState) => void,
) {
  /**
   * Where the view is. Main's to hold: the renderer asks for a step and draws
   * what comes back. Empty reads as the journal.
   */
  let trail: Place[] = [];

  /**
   * What is open changed, so the trail starts over at the journal: a trail is
   * a way through one set of pages and means nothing in another. Fed from
   * outside, like `refreshPages` — pages are never told what is open, only
   * that it is not what it was.
   */
  function resetTrail(): void {
    trail = [];
  }

  /**
   * Sends every window what is showing now. The one way state reaches the
   * renderer: after a write, after a step along the trail, and after another
   * device's events are folded in.
   *
   * One at a time, in the order they were asked for. Each resolves once its
   * own state is sent, which is what lets a write promise that the state
   * arrives before its reply does.
   *
   * A ledger that cannot be read sends nothing: the windows keep what they
   * have, and the call that asked — `show`, or a write — has already said why.
   */
  let sending: Promise<void> = Promise.resolve();

  function publish(): Promise<void> {
    sending = sending
      .then(async () => {
        broadcast(getState(await open.require(), trail, today(now())));
      })
      .catch((): void => undefined);
    return sending;
  }

  /** Takes one step along the trail and sends where it led. */
  function step(take: (trail: Place[]) => Place[]): Promise<void> {
    trail = take(trail);
    return publish();
  }

  /**
   * A write: `run` appends, and the state it led to is sent before the reply.
   * `open.require` is called as the write arrives, so where it goes is settled
   * then, not when its turn comes.
   *
   * One at a time, in the order they arrived. Each is checked against the fold
   * before it is appended, and the renderer draws a write before it is recorded
   * — so the next one can name a block the one before is still writing. Checked
   * early, that is "No such block" for a block the user is looking at. A write
   * that is refused does not hold up the ones behind it.
   */
  let writing: Promise<unknown> = Promise.resolve();

  function write(run: (view: PagesView) => Promise<unknown>): Promise<void> {
    const view = open.require();
    // Waited on in turn, which may be later than it fails.
    view.catch((): void => undefined);
    const turn = writing.then(async () => {
      await run(await view);
      await publish();
    });
    writing = turn.catch((): void => undefined);
    return turn;
  }

  return {
    resetTrail,

    /**
     * The pages may be behind: something arrived in the open ledger's folder.
     * Fed from outside, so pages never subscribes to the ledger itself, and
     * never asks which ledger moved — whoever calls this has already settled
     * that it is the one on screen.
     */
    refreshPages(): void {
      void publish();
    },

    /**
     * Sends what is showing, for a view that has just mounted. Asks for the
     * pages here as well as in `publish`, which swallows a refusal: a view
     * with nothing on screen yet is the one caller that has to hear it.
     */
    async show(): Promise<void> {
      await open.require();
      await publish();
    },

    go: (place: Place) => step((trail) => go(trail, place)),
    back: () => step(back),
    rezoom: (block?: string) => step((trail) => rezoom(trail, block)),

    locate: async (blockId: string) =>
      locateBlock((await open.require()).state, blockId),
    search: async (query: string): Promise<string[]> =>
      searchPages((await open.require()).state, query),
    status: async (): Promise<LogStatus> =>
      getLogStatus(await open.require()),

    /** `after` absent puts the block at the end of the page. */
    addBlock: (id: string, title: string, text: string, after?: string) =>
      write((view) => addBlock(view, title, text, after, id)),
    editBlock: (blockId: string, text: string) =>
      write((view) => editBlock(view, blockId, text)),
    deleteBlock: (blockId: string) =>
      write((view) => deleteBlock(view, blockId)),
    indentBlock: (blockId: string) =>
      write((view) => indentBlock(view, blockId)),
    outdentBlock: (blockId: string) =>
      write((view) => outdentBlock(view, blockId)),

    /**
     * No event: the image is in the notes once a block's text links it, and
     * that is an ordinary edit.
     */
    addImage: (bytes: Uint8Array, mime: string) => open.saveImage(bytes, mime),
    findImage: (name: string) => open.findImage(name),
  };
}

export type PagesSession = ReturnType<typeof createPagesSession>;
