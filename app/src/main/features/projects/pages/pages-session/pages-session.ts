/**
 * The pages of what is open, as the windows see them: what shows at a place,
 * the word that the fold has moved, and the order the writes are recorded in.
 * Images are not here: storing one writes no event (see `pages-ipc.ts`).
 * Where a window is looking is the window's (`ProjectView`), not this one's.
 *
 * Free of `electron` imports, so it runs under `node --test`; `pages-ipc.ts`
 * is only the channels in front of it, and the windows `notify` sends to.
 */
import {
  addBlock,
  deleteBlock,
  editBlock,
  indentBlock,
  locateBlock,
  outdentBlock,
  removeProperty,
  renameProperty,
  searchBlocks,
  searchPages,
  setProperty,
} from "@pbnotes/pages";
import type { PagesView as Base } from "@pbnotes/pages";
import type { Command, Matches, Place, PlaceView } from "../../../../../shared/pages.ts";
import type { LogStatus } from "../../../../../shared/log.ts";
import { getView } from "../place-view/place-view.ts";

/**
 * What pages need of what is open: the package's view (the fold and a way to
 * write to it), how much of the log could be read, and the fold's version.
 * Declared here, by the one that uses it; `ledgers.ts` hands out a view that
 * is one without importing this.
 */
export type PagesView = Base & {
  /**
   * How much of the folder could be read, and what in it was skipped.
   * Nothing here is an error to clear — a log that is still syncing is a
   * normal state that usually heals itself — but none of it may be skipped
   * without the user being able to find out.
   */
  readonly status: LogStatus;
  /**
   * The fold's version as `state` stands: one more every time it changes.
   * Read beside `state`, with no `await` between, it labels what was read.
   */
  readonly version: number;
};

/**
 * What is open, as whoever makes this hands it over: the pages of it. Pages
 * are told nothing else — not what decides what is open, not what it is, and
 * not where it is kept.
 *
 * `require` is the one to read and write through. It refuses what cannot be
 * reached — opening a ledger creates its directory, and that must not happen
 * on a drive that is not there — and it settles what is open before its
 * first `await`, so a write calls it first: a write sent just before that
 * changed still lands where it was typed.
 */
export type Open = {
  require(): Promise<PagesView>;
};

/**
 * `notify` tells every window the fold's version, handed in like everything
 * else this reaches outside. The write queue lives in here, one per call.
 */
export function createPagesSession(
  open: Open,
  notify: (version: number) => void,
) {
  /**
   * A write: `run` appends, and resolves to the fold's version after it.
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

  function write(run: (view: PagesView) => Promise<unknown>): Promise<number> {
    const view = open.require();
    // Waited on in turn, which may be later than it fails.
    view.catch((): void => undefined);
    const turn = writing.then(async () => {
      const it = await view;
      await run(it);
      // A write that changed nothing (an indent with nowhere to go) names the
      // version already held, which is as true.
      return it.version;
    });
    writing = turn.catch((): void => undefined);
    return turn;
  }

  return {
    /**
     * The fold moved: a write from any window, or something arrived in the
     * open ledger's folder. Fed from outside, so pages never subscribes to
     * the ledger itself, and never asks which ledger moved — whoever calls
     * this has already settled that it is the one on screen. A ledger that
     * cannot be read tells nobody anything.
     */
    refreshPages(): void {
      open.require().then(
        (view) => notify(view.version),
        (): void => undefined,
      );
    },

    /**
     * What shows at `place`, or the journal with `today` on top, and the
     * version it was read at. Rejects when what is open cannot be reached.
     */
    view: async (place: Place | undefined, today: string): Promise<PlaceView> =>
      getView(await open.require(), place, today),

    locate: async (blockId: string) =>
      locateBlock((await open.require()).state, blockId),
    search: async (query: string): Promise<string[]> =>
      searchPages((await open.require()).state, query),
    find: async (query: string): Promise<Matches> => {
      const { state } = await open.require();
      return { pages: searchPages(state, query), blocks: searchBlocks(state, query) };
    },
    status: async (): Promise<LogStatus> => (await open.require()).status,

    /**
     * Records `command`, checked by `requireCommand` before it gets here, as
     * the `@pbnotes/pages` command it names (#158). Through `write`, so every
     * write is recorded one at a time in the order it arrived.
     */
    run: (command: Command) => write((view) => apply(view, command)),
  };
}

export type PagesSession = ReturnType<typeof createPagesSession>;

/** A command run as the one `@pbnotes/pages` command it names. */
function apply(view: PagesView, command: Command): Promise<unknown> {
  switch (command.type) {
    case "addBlock": {
      const { title, text, after, id } = command;
      return addBlock(view, title, text, after, id);
    }
    case "editBlock":
      return editBlock(view, command.blockId, command.text);
    case "deleteBlock":
      return deleteBlock(view, command.blockId);
    case "indentBlock":
      return indentBlock(view, command.blockId);
    case "outdentBlock":
      return outdentBlock(view, command.blockId);
    case "setProperty":
      return setProperty(view, command.title, command.key, command.value);
    case "removeProperty":
      return removeProperty(view, command.title, command.key);
    case "renameProperty":
      return renameProperty(view, command.title, command.from, command.to);
    default: {
      // Does not compile once `Command` has a case this switch lacks.
      const unhandled: never = command;
      throw new TypeError(`Unknown command ${(unhandled as Command).type}`);
    }
  }
}
