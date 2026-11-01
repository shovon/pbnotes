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
import { requireCommand, requireDay, requireTitle } from "./command/command";
import type { PagesSession } from "./pages-session/pages-session";

// This software is split into two components: the renderer, and the main
// process. Neither can see each other directly, and IPC is the only way to
// relay information among eachother.
//
// This file is the pages side of that: each channel checks what arrives and
// hands it to the session (`pages-session.ts`), which answers what shows at
// a place and holds the order writes are recorded in. What only Electron can do — sending to the
// windows, the image scheme, the native menu — is here too.

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

/** Registers the pages channels, and the image scheme, against `session`. */
export function registerPageIpc(session: PagesSession): void {
  ipcMain.handle(PAGE_CHANNELS.view, (_event, place: unknown, today: unknown) =>
    session.view(requirePlace(place), requireDay(today)),
  );

  ipcMain.handle(PAGE_CHANNELS.locate, (_event, blockId: unknown) =>
    session.locate(requireString(blockId, "blockId")),
  );

  ipcMain.handle(PAGE_CHANNELS.search, (_event, query: unknown) =>
    session.search(requireString(query, "query")),
  );

  ipcMain.handle(PAGE_CHANNELS.status, () => session.status());

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
      return session.addImage(bytes, requireString(mime, "mime"));
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
    const file = await session.findImage(
      new URL(request.url).pathname.slice(1),
    );
    return file
      ? net.fetch(pathToFileURL(file).toString())
      : new Response(null, { status: 404 });
  });

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
