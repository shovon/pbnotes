import {
  BrowserWindow,
  Menu,
  clipboard,
  ipcMain,
  net,
  protocol,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { pathToFileURL } from "node:url";
import { IMAGE_SCHEME, PAGE_CHANNELS } from "../../../../shared/pages";
import type { BlockMenuPick, PageMenuPick, Place } from "../../../../shared/pages";
import { requireString } from "../../../ipc";
import { readOffer } from "./block-menu/block-menu";
import { readOffer as readPageOffer, readPoint } from "./page-menu/page-menu";
import { requireCommand, requireDay, requireTitle } from "./command/command";
import type { PagesSession } from "./pages-session/pages-session";

// This software is split into two components: the renderer, and the main
// process. Neither can see each other directly, and IPC is the only way to
// relay information among eachother.
//
// This file is the pages side of that: each channel checks what arrives and
// hands it to the session (`pages-session.ts`), which answers what shows at
// a place and holds the order writes are recorded in, or to the images of
// what is open. What only Electron can do — sending to the windows, the image
// scheme, the native menu — is here too.

/**
 * The images of what is open, as `index.ts` builds them. No event is written
 * for one: an image is in the notes once a block's text links it, and that is
 * an ordinary edit through the session, so images skip it.
 *
 * `save` refuses what cannot be reached, and settles what is open before its
 * first `await`, as the session's `require` does: an image pasted just before
 * that changed lands where it was pasted. `find` only reads, and opens
 * nothing: with nothing open, or a drive that is not there, it finds nothing.
 */
export type Images = {
  /** Stores an image and returns what a note links it by. */
  save(bytes: Uint8Array, mime: string): Promise<string>;
  /** The file a note's `images/<name>` is, or undefined. */
  find(name: string): Promise<string | undefined>;
};

/**
 * Tells every window the fold's version, over `pages:changed`; each asks
 * again for the place it is on. A window closing between the read and the
 * send is ordinary, which is the only thing the guard is for.
 */
export function broadcastPages(version: number): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(PAGE_CHANNELS.changed, version);
    }
  }
}

/** A place as it crossed the bridge: none is the journal. */
function requirePlace(place: unknown): Place | undefined {
  if (place === undefined || place === null) return undefined;
  const { page, block } = place as Record<string, unknown>;
  return {
    page: requireTitle(page),
    ...(block === undefined ? {} : { block: requireString(block, "block") }),
  };
}

/**
 * Registers the pages channels against `session`, and the image channel and
 * scheme against `images`.
 */
export function registerPageIpc(session: PagesSession, images: Images): void {
  ipcMain.handle(PAGE_CHANNELS.view, (_event, place: unknown, today: unknown) =>
    session.view(requirePlace(place), requireDay(today)),
  );

  ipcMain.handle(PAGE_CHANNELS.locate, (_event, blockId: unknown) =>
    session.locate(requireString(blockId, "blockId")),
  );

  ipcMain.handle(PAGE_CHANNELS.search, (_event, query: unknown) =>
    session.search(requireString(query, "query")),
  );

  ipcMain.handle(PAGE_CHANNELS.find, (_event, query: unknown) =>
    session.find(requireString(query, "query")),
  );

  ipcMain.handle(PAGE_CHANNELS.status, () => session.status());

  ipcMain.handle(PAGE_CHANNELS.deleteImpact, (_event, title: unknown) =>
    session.deleteImpact(requireTitle(title)),
  );

  // Every write, on one channel (#158): the command's shape is checked
  // here, and the session runs the package command it names.
  ipcMain.handle(PAGE_CHANNELS.command, (_event, command: unknown) =>
    session.run(requireCommand(command)),
  );

  ipcMain.handle(
    PAGE_CHANNELS.addImage,
    (_event, bytes: unknown, mime: unknown) => {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("Expected bytes to be a Uint8Array");
      }
      return images.save(bytes, requireString(mime, "mime"));
    },
  );

  /**
   * `pbnotes-image://images/<name>`: the image a note links as
   * `images/<name>`, out of whatever is open. The URL is built from note
   * text, so the name is checked by `find` before it is anywhere near a
   * path. The same name is the same bytes wherever it is kept — it is their
   * hash — so a URL that outlives a change of what is open cannot show the
   * wrong picture.
   */
  protocol.handle(IMAGE_SCHEME, async (request) => {
    // Not decoded: a name that needed escaping is not one `find` takes.
    const file = await images.find(
      new URL(request.url).pathname.slice(1),
    );
    return file
      ? net.fetch(pathToFileURL(file).toString())
      : new Response(null, { status: 404 });
  });

  // Native rather than drawn: placement at the screen edge, keyboard and
  // dismissal come with it. More items go in the template.
  //
  // Copying is done here; anything else is answered back for the window to
  // do. The reply settles on the first of an item's `click` and the menu
  // closing. Which of the two the platform reports first is not promised,
  // so the close waits a moment before it answers that nothing was picked:
  // nothing is waiting on that answer, and a pick is never lost to it.
  ipcMain.handle(
    PAGE_CHANNELS.blockMenu,
    (event, blockId: unknown, offer: unknown) => {
      const id = requireString(blockId, "blockId");
      const offered = readOffer(offer);
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return new Promise<BlockMenuPick | null>((resolve) => {
        const items: MenuItemConstructorOptions[] = [
          {
            label: "Copy Block Reference",
            click: () => {
              clipboard.writeText(`((${id}))`);
              resolve(null);
            },
          },
        ];
        if (offered.delete) {
          items.push(
            // Apart from copying: one leaves the notes as they were, and
            // this one does not.
            { type: "separator" },
            {
              label: "Delete Block",
              click: () => resolve("delete"),
            },
          );
        }
        Menu.buildFromTemplate(items).popup({
          window,
          callback: () => setTimeout(() => resolve(null), 100),
        });
      });
    },
  );

  // The page's menu, from its ⋯ button. Everything on it is answered back
  // for the window to do, and settles the way the block menu's does: on the
  // first of a `click` and the close, with the close a moment late.
  ipcMain.handle(
    PAGE_CHANNELS.pageMenu,
    (event, at: unknown, offer: unknown) => {
      const point = readPoint(at);
      const offered = readPageOffer(offer);
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return new Promise<PageMenuPick | null>((resolve) => {
        Menu.buildFromTemplate([
          {
            label: "Delete Page…",
            enabled: offered.delete === true,
            click: () => resolve("delete"),
          },
        ]).popup({
          window,
          ...point,
          callback: () => setTimeout(() => resolve(null), 100),
        });
      });
    },
  );
}
