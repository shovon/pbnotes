/**
 * The graph of what is open, as the windows see them: what shows at a place,
 * the word that the fold has moved, and the order the writes are recorded in.
 * Images are not here: storing one writes no event (see `graph-ipc.ts`).
 * Where a window is looking is the window's (`ProjectView`), not this one's.
 *
 * Free of `electron` imports, so it runs under `node --test`; `graph-ipc.ts`
 * is only the channels in front of it, and the windows `notify` sends to.
 */
import {
  addBlock,
  addTag,
  batch,
  deleteBlock,
  deleteBlocks,
  indentBlocks,
  outdentBlocks,
  pasteBlocks,
  deletePage,
  renamePage,
  editBlock,
  indentBlock,
  listPages,
  locateBlock,
  moveBlock,
  moveBlocks,
  outdentBlock,
  removeProperty,
  removeTag,
  renameProperty,
  searchBlocks,
  searchNames,
  setProperty,
} from "@pbnotes/graph";
import type { Batched, GraphView as Base, PageMatch } from "@pbnotes/graph";
import type {
  Command,
  Matches,
  PageList,
  Place,
  PlaceView,
  Reply,
  Taking,
  Undone,
} from "../../../../../shared/graph.ts";
import type { LogStatus } from "../../../../../shared/log.ts";
import { getView } from "../place-view/place-view.ts";
import { createHistory, stepOf, takenBack } from "../history/history.ts";
import type { History, Way } from "../history/history.ts";

/**
 * What the graph needs of what is open: the package's view (the fold and a way to
 * write to it), how much of the log could be read, and the fold's version.
 * Declared here, by the one that uses it; `ledgers.ts` hands out a view that
 * is one without importing this.
 */
export type GraphView = Base & {
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
 * What is open, as whoever makes this hands it over: the graph of it. The
 * graph is told nothing else — not what decides what is open, not what it is, and
 * not where it is kept.
 *
 * `require` is the one to read and write through. It refuses what cannot be
 * reached — opening a ledger creates its directory, and that must not happen
 * on a drive that is not there — and it settles what is open before its
 * first `await`, so a write calls it first: a write sent just before that
 * changed still lands where it was typed.
 */
export type Open = {
  require(): Promise<GraphView>;
};

/**
 * `notify` tells every window the fold's version, handed in like everything
 * else this reaches outside. The write queue lives in here, one per call, and
 * so does undo's history (#234), unless one is handed in.
 */
export function createGraphSession(
  open: Open,
  notify: (version: number) => void,
  history: History<GraphView> = createHistory<GraphView>(),
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

  function write<R>(run: (view: GraphView) => Promise<R>): Promise<R> {
    const view = open.require();
    // Waited on in turn, which may be later than it fails.
    view.catch((): void => undefined);
    const turn = writing.then(async () => run(await view));
    writing = turn.catch((): void => undefined);
    return turn;
  }

  /**
   * `command` run on `view`, and kept as a step when it wrote something: the
   * events it dispatched, on the graph before it. Its turn in the queue is
   * the whole of it, so nothing else writes between the graph before and the
   * events.
   */
  async function recorded(view: GraphView, command: Exclude<Command, Taking>): Promise<number> {
    const before = view.state;
    const events: Batched[] = [];
    const tapped: GraphView = {
      get state() {
        return view.state;
      },
      get version() {
        return view.version;
      },
      get status() {
        return view.status;
      },
      dispatch(v, type, payload) {
        events.push({ v, type, payload });
        return view.dispatch(v, type, payload);
      },
    };
    try {
      await apply(tapped, command);
    } finally {
      // A command that throws after writing (a rename's second check, say)
      // has still written: what it wrote is a step like any other.
      const entry = stepOf(before, view.state, events);
      if (entry) history.record(view, entry);
    }
    // A write that changed nothing (an indent with nowhere to go) names the
    // version already held, which is as true.
    return view.version;
  }

  /**
   * The next step `way` taken back, by writing what takes it back as one
   * batch, or why it stops. What it writes is kept the other way: an undo
   * can be redone, which writes the step's own events again, and a redo
   * undone.
   */
  async function take(view: GraphView, way: Way): Promise<Undone> {
    const next = history.next(view, way, view.state);
    if (next.kind === "nothing") return { version: view.version, result: "nothing" };
    if (next.kind === "stopped") {
      return { version: view.version, result: next.why, ...next.where };
    }
    const before = view.state;
    const written = batch(next.inverse);
    await view.dispatch(written.v, written.type, written.payload);
    history.taken(view, way, next.entry, takenBack(next.entry, before, written));
    return { version: view.version, result: "done", ...next.entry.where };
  }

  return {
    /**
     * The fold moved: a write from any window, or something arrived in the
     * open ledger's folder. Fed from outside, so the graph never subscribes to
     * the ledger itself, and never asks which ledger moved — whoever calls
     * this has already settled that it is the one on screen. A ledger that
     * cannot be read tells nobody anything.
     */
    refreshGraph(): void {
      open.require().then(
        (view) => notify(view.version),
        (): void => undefined,
      );
    },

    /**
     * What shows at `place`, or the journal with `today` on top, its list
     * loaded `through` a day or a title (#282, #285), and the version it was
     * read at. Rejects when what is open cannot be reached.
     */
    view: async (place: Place | undefined, today: string, through?: string): Promise<PlaceView> =>
      getView(await open.require(), place, today, through),

    locate: async (blockId: string) =>
      locateBlock((await open.require()).state, blockId),
    search: async (query: string): Promise<PageMatch[]> =>
      searchNames((await open.require()).state, query),
    find: async (query: string): Promise<Matches> => {
      const { state } = await open.require();
      return { pages: searchNames(state, query), blocks: searchBlocks(state, query) };
    },
    /** Every page, read beside the version, with no `await` between them. */
    pages: async (): Promise<PageList> => {
      const view = await open.require();
      return { version: view.version, pages: listPages(view.state) };
    },
    status: async (): Promise<LogStatus> => (await open.require()).status,

    /**
     * Records `command`, checked by `requireCommand` before it gets here, as
     * the `@pbnotes/graph` command it names (#158), and keeps it as a step to
     * undo. Undo and redo take a step back instead (#234). Through `write`,
     * so every write is recorded one at a time in the order it arrived.
     */
    run: <C extends Command>(command: C): Promise<Reply<C>> =>
      (isTaking(command)
        ? write((view) => take(view, command.type))
        : write((view) => recorded(view, command))) as Promise<Reply<C>>,

    /**
     * Undo's history, gone: the open project changed (#234). A write still
     * queued for the project before keeps its step under that project's
     * graph, never this one's.
     */
    forget(): void {
      history.forget();
    },
  };
}

export type GraphSession = ReturnType<typeof createGraphSession>;

/** Whether `command` takes a step back, rather than writing one. */
function isTaking(command: Command): command is Taking {
  return command.type === "undo" || command.type === "redo";
}

/** A command run as the one `@pbnotes/graph` command it names. */
function apply(view: GraphView, command: Exclude<Command, Taking>): Promise<unknown> {
  switch (command.type) {
    case "addBlock": {
      const { title, text, after, id } = command;
      return addBlock(view, title, text, after, id);
    }
    case "editBlock":
      return editBlock(view, command.blockId, command.text);
    case "deleteBlock":
      return deleteBlock(view, command.blockId);
    case "deleteBlocks":
      return deleteBlocks(view, command.blockIds);
    case "indentBlocks":
      return indentBlocks(view, command.blockIds);
    case "outdentBlocks":
      return outdentBlocks(view, command.blockIds);
    case "pasteBlocks": {
      const { title, blocks, into, after, parent, first } = command;
      const at = into !== undefined ? { into } : { after, parent, first };
      return pasteBlocks(view, title, blocks, at);
    }
    case "indentBlock":
      return indentBlock(view, command.blockId);
    case "outdentBlock":
      return outdentBlock(view, command.blockId);
    case "moveBlock": {
      const { blockId, title, after, parent, first } = command;
      return moveBlock(view, blockId, title, { after, parent, first });
    }
    case "moveBlocks": {
      const { blockIds, title, after, parent, first } = command;
      return moveBlocks(view, blockIds, title, { after, parent, first });
    }
    case "setProperty":
      return setProperty(view, command.title, command.key, command.value);
    case "removeProperty":
      return removeProperty(view, command.title, command.key);
    case "renameProperty":
      return renameProperty(view, command.title, command.from, command.to);
    case "addTag":
      return addTag(view, command.title, command.tag);
    case "removeTag":
      return removeTag(view, command.title, command.tag);
    case "deletePage":
      return deletePage(view, command.title);
    case "renamePage":
      return renamePage(view, command.title, command.to);
    default: {
      // Does not compile once `Command` has a case this switch lacks.
      const unhandled: never = command;
      throw new TypeError(`Unknown command ${(unhandled as Command).type}`);
    }
  }
}
