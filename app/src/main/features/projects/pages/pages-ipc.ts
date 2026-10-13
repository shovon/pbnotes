import {
  BrowserWindow,
  Menu,
  clipboard,
  ipcMain,
  net,
  protocol,
} from "electron";
import { pathToFileURL } from "node:url";
import { IMAGE_SCHEME, PAGE_CHANNELS, today } from "../../../../shared/pages";
import type { Place } from "../../../../shared/pages";
import { requireString } from "../../../ipc";
import {
  addBlock,
  deleteBlock,
  editBlock,
  getLogStatus,
  getState,
  indentBlock,
  locateBlock,
  outdentBlock,
} from "./pages-store/pages-store";
import { back, go, rezoom } from "./trail/trail";
import { findImage, saveImage } from "./images/images";
import {
  deviceOf,
  logDirectory,
} from "../../../ledger/project-ledger/project-ledger";
import type { LedgerRef } from "../../../ledger/project-ledger/project-ledger";

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
 * The ledger the pages are kept in, as whoever registers this hands it over.
 * Pages are told where they are kept and nothing else: not what decides which
 * ledger is open, and not what it is a ledger of.
 *
 * `require` is the one to write through. It refuses a ledger that cannot be
 * reached — opening one creates its directory, and that must not happen on a
 * drive that is not there — and it settles which ledger before its first
 * `await`, so a handler calls it first: a write sent just before the open
 * ledger changed still lands where it was typed. `peek` only says which one
 * is open, for what reads without opening anything.
 */
export type Open = {
  require(): Promise<LedgerRef>;
  peek(): LedgerRef | null;
};

let open: Open;

/**
 * Where the view is, and the ledger that is a trail through. Main's to hold:
 * the renderer asks for a step and draws what comes back. A trail through
 * another ledger is nobody's, so it reads as the journal — which is all the
 * open ledger changing has to do to start over.
 */
let route: { ledger: string; trail: Place[] } | undefined;

function trailOf(ledger: LedgerRef): Place[] {
  return route?.ledger === ledger.id ? route.trail : [];
}

/** Takes one step along the trail and sends where it led. */
function step(take: (trail: Place[]) => Place[]): Promise<void> {
  const ledger = open.peek();
  if (!ledger) throw new Error("Nothing is open");
  route = { ledger: ledger.id, trail: take(trailOf(ledger)) };
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
      const ledger = await open.require();
      const state = await getState(ledger, trailOf(ledger), today());
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
 * A ledger's pages may be behind: something arrived in its folder. Fed from
 * outside, so pages never subscribes to the ledger itself. Only the open one
 * is on screen.
 */
export function refreshPages(ledgerId: string): void {
  if (open.peek()?.id === ledgerId) void publish();
}

/**
 * A write: `run` appends, and the state it led to is sent before the reply.
 * `open.require` is called as the call arrives, so which ledger it goes to is
 * settled then.
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
  run: (ledger: LedgerRef, ...args: unknown[]) => Promise<unknown>,
): void {
  ipcMain.handle(channel, (_event, ...args: unknown[]) => {
    const ledger = open.require();
    // Waited on in turn, which may be later than it fails.
    ledger.catch((): void => undefined);
    const turn = writing.then(async () => {
      await run(await ledger, ...args);
      await publish();
    });
    writing = turn.catch((): void => undefined);
    return turn;
  });
}

export function registerPageIpc(from: Open): void {
  open = from;

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

  ipcMain.handle(PAGE_CHANNELS.status, async () =>
    getLogStatus(await open.require()),
  );

  writes(PAGE_CHANNELS.addBlock, (ledger, id, title, text, after) =>
    addBlock(
      ledger,
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
      const ledger = await open.require();
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("Expected bytes to be a Uint8Array");
      }
      // No event: the image is in the notes once a block's text links it, and
      // that is an ordinary edit.
      return saveImage(
        logDirectory(ledger.path),
        await deviceOf(ledger),
        bytes,
        requireString(mime, "mime"),
      );
    },
  );

  /**
   * `pbnotes-image://images/<name>`: the image a note links as
   * `images/<name>`, out of the ledger that is open. The URL is built from
   * note text, so the name is checked by `findImage` before it is anywhere
   * near a path. The same name is the same bytes in any ledger — it is their
   * hash — so a URL that outlives a change of ledger cannot show the wrong
   * picture.
   *
   * `peek`, not `require`: this only reads. `findImage` lists
   * directories and creates none, so an unmounted drive is a 404, not a path
   * invented on the local disk.
   */
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const ledger = open.peek();
    const file =
      ledger &&
      // Not decoded: a name that needed escaping is not one `findImage` takes.
      (await findImage(
        logDirectory(ledger.path),
        new URL(request.url).pathname.slice(1),
      ));
    return file
      ? net.fetch(pathToFileURL(file).toString())
      : new Response(null, { status: 404 });
  });

  // No title on any of these four. The block id is the whole address, so
  // there is nothing to check a title against and nothing to write one into.
  writes(PAGE_CHANNELS.editBlock, (ledger, blockId, text) =>
    editBlock(
      ledger,
      requireString(blockId, "blockId"),
      requireString(text, "text"),
    ),
  );

  writes(PAGE_CHANNELS.deleteBlock, (ledger, blockId) =>
    deleteBlock(ledger, requireString(blockId, "blockId")),
  );

  writes(PAGE_CHANNELS.indentBlock, (ledger, blockId) =>
    indentBlock(ledger, requireString(blockId, "blockId")),
  );

  writes(PAGE_CHANNELS.outdentBlock, (ledger, blockId) =>
    outdentBlock(ledger, requireString(blockId, "blockId")),
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
}
