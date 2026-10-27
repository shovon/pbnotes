import {
  BrowserWindow,
  Menu,
  clipboard,
  ipcMain,
  net,
  protocol,
} from "electron";
import { pathToFileURL } from "node:url";
import { IMAGE_SCHEME, PAGE_CHANNELS } from "../../../../shared/pages";
import type { Place } from "../../../../shared/pages";
import { requireString } from "../../../ipc";
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
import { getLogStatus, getState } from "./pages-store/pages-store";
import type { PagesView } from "./pages-store/pages-store";
import { back, go, rezoom } from "./trail/trail";

// This software is split into two components: the renderer, and the main
// process. Neither can see each other directly, and IPC is the only way to
// relay information among eachother.
//
// This file exists such that when a user event is triggered, handlers for them
// capture them, and record them, and carry out any other domain-specific
// activities.

/**
 * A title is a key in a log that keeps everything forever, so it is checked
 * on arrival: something, and nothing loose around it. Not a date pattern any
 * more — a link can name a page anything — but the link plugin trims what it
 * names, and a title that arrives untrimmed came from somewhere else.
 */
function requireTitle(value: unknown): string {
  const title = requireString(value, "title");
  if (title === "" || title !== title.trim()) {
    throw new TypeError("Expected a page title");
  }
  return title;
}

/**
 * A block's id comes from the renderer, which drew the block under it before
 * asking for it to be written. It is checked like a title, and for the same
 * reason: it is a key in a log that keeps everything forever.
 */
function requireBlockId(value: unknown): string {
  const id = requireString(value, "id");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) {
    throw new TypeError("Expected a block id");
  }
  return id;
}

/**
 * What is open, as whoever registers this hands it over: the pages of it, and
 * the images kept beside them. Pages are told nothing else — not what decides
 * what is open, not what it is, and not where it is kept.
 *
 * `require` is the one to read and write through. It refuses what cannot be
 * reached — opening a ledger creates its directory, and that must not happen
 * on a drive that is not there — and it settles what is open before its
 * first `await`, so a handler calls it first: a write sent just before that
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
 * Registers the pages channels against `open`, and returns what the caller
 * feeds in from outside: that the pages may be behind, and that what is open
 * changed. The trail and the two queues live in here, one set per call.
 *
 * `now` is the clock that decides which day is today, handed in like
 * everything else this reads from outside.
 */
export function registerPageIpc(
  open: Open,
  now: () => Date,
): {
  refreshPages(): void;
  resetTrail(): void;
} {
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

  /** Takes one step along the trail and sends where it led. */
  function step(take: (trail: Place[]) => Place[]): Promise<void> {
    trail = take(trail);
    return publish();
  }

  /**
   * Sends every window what is showing now. The one way state reaches the
   * renderer: after a write, after a step along the trail, and after another
   * device's events are folded in.
   *
   * One at a time, in the order they were asked for. Reading the state takes
   * several turns, and two of them overlapping could send the older one last.
   * Each resolves once its own state is sent, which is what lets a handler
   * promise that the state arrives before its reply does.
   *
   * A ledger that cannot be read sends nothing: the windows keep what they
   * have, and the call that asked — `show`, or a write — has already said why.
   * A window closing between the read and the send is ordinary, which is the
   * only thing the guard is for.
   */
  let sending: Promise<void> = Promise.resolve();

  function publish(): Promise<void> {
    sending = sending
      .then(async () => {
        const state = getState(await open.require(), trail, today(now()));
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send(PAGE_CHANNELS.changed, state);
          }
        }
      })
      .catch((): void => undefined);
    return sending;
  }

  /**
   * The pages may be behind: something arrived in the open ledger's folder. Fed
   * from outside, so pages never subscribes to the ledger itself, and never
   * asks which ledger moved — whoever calls this has already settled that it is
   * the one on screen.
   */
  function refreshPages(): void {
    void publish();
  }

  /**
   * A write: `run` appends, and the state it led to is sent before the reply.
   * `open.require` is called as the call arrives, so where it goes is settled
   * then.
   *
   * One at a time, in the order they arrived. Each is checked against the fold
   * before it is appended, and the renderer draws a write before it is recorded
   * — so the next one can name a block the one before is still writing. Checked
   * early, that is "No such block" for a block the user is looking at. A write
   * that is refused does not hold up the ones behind it.
   */
  let writing: Promise<unknown> = Promise.resolve();

  function writes(
    channel: string,
    run: (view: PagesView, ...args: unknown[]) => Promise<unknown>,
  ): void {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => {
      const view = open.require();
      // Waited on in turn, which may be later than it fails.
      view.catch((): void => undefined);
      const turn = writing.then(async () => {
        await run(await view, ...args);
        await publish();
      });
      writing = turn.catch((): void => undefined);
      return turn;
    });
  }


  ipcMain.handle(PAGE_CHANNELS.show, async () => {
    // Asked for here as well as in `publish`, which swallows it: a view that
    // has just mounted is the one caller with nothing on screen to keep.
    await open.require();
    await publish();
  });

  ipcMain.handle(PAGE_CHANNELS.go, (_event, place: unknown) => {
    const { page, block } = (place ?? {}) as Record<string, unknown>;
    const next: Place = {
      page: requireTitle(page),
      ...(block === undefined ? {} : { block: requireString(block, "block") }),
    };
    return step((trail) => go(trail, next));
  });

  ipcMain.handle(PAGE_CHANNELS.back, () => step(back));

  ipcMain.handle(PAGE_CHANNELS.rezoom, (_event, block: unknown) => {
    const to = block === undefined ? undefined : requireString(block, "block");
    return step((trail) => rezoom(trail, to));
  });

  ipcMain.handle(PAGE_CHANNELS.locate, async (_event, blockId: unknown) =>
    locateBlock(await open.require(), requireString(blockId, "blockId")),
  );

  ipcMain.handle(PAGE_CHANNELS.search, async (_event, query: unknown) =>
    searchPages(await open.require(), requireString(query, "query")),
  );

  ipcMain.handle(PAGE_CHANNELS.status, async () =>
    getLogStatus(await open.require()),
  );

  writes(PAGE_CHANNELS.addBlock, (view, id, title, text, after) =>
    addBlock(
      view,
      requireTitle(title),
      requireString(text, "text"),
      // Absent means the end of the page; anything else has to be a block id
      // before it reaches a log that keeps it forever.
      after === undefined ? undefined : requireString(after, "after"),
      requireBlockId(id),
    ),
  );

  ipcMain.handle(
    PAGE_CHANNELS.addImage,
    async (_event, bytes: unknown, mime: unknown) => {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("Expected bytes to be a Uint8Array");
      }
      // No event: the image is in the notes once a block's text links it, and
      // that is an ordinary edit.
      return open.saveImage(bytes, requireString(mime, "mime"));
    },
  );

  /**
   * `pbnotes-image://images/<name>`: the image a note links as
   * `images/<name>`, out of whatever is open. The URL is built from note
   * text, so the name is checked by `findImage` before it is anywhere near a
   * path. The same name is the same bytes wherever it is kept — it is their
   * hash — so a URL that outlives a change of what is open cannot show the
   * wrong picture.
   */
  protocol.handle(IMAGE_SCHEME, async (request) => {
    // Not decoded: a name that needed escaping is not one `findImage` takes.
    const file = await open.findImage(new URL(request.url).pathname.slice(1));
    return file
      ? net.fetch(pathToFileURL(file).toString())
      : new Response(null, { status: 404 });
  });

  // No title on any of these four. The block id is the whole address, so
  // there is nothing to check a title against and nothing to write one into.
  writes(PAGE_CHANNELS.editBlock, (view, blockId, text) =>
    editBlock(
      view,
      requireString(blockId, "blockId"),
      requireString(text, "text"),
    ),
  );

  writes(PAGE_CHANNELS.deleteBlock, (view, blockId) =>
    deleteBlock(view, requireString(blockId, "blockId")),
  );

  writes(PAGE_CHANNELS.indentBlock, (view, blockId) =>
    indentBlock(view, requireString(blockId, "blockId")),
  );

  writes(PAGE_CHANNELS.outdentBlock, (view, blockId) =>
    outdentBlock(view, requireString(blockId, "blockId")),
  );

  // Native rather than drawn: placement at the screen edge, keyboard and
  // dismissal come with it. More items go in the template.
  ipcMain.handle(PAGE_CHANNELS.blockMenu, (event, blockId: unknown) => {
    const id = requireString(blockId, "blockId");
    Menu.buildFromTemplate([
      {
        label: "Copy Block Reference",
        click: () => clipboard.writeText(`((${id}))`),
      },
    ]).popup({
      window: BrowserWindow.fromWebContents(event.sender) ?? undefined,
    });
  });

  return { refreshPages, resetTrail };
}
