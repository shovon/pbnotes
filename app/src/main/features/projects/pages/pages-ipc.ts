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
import type { PagesState, Place } from "../../../../shared/pages";
import { requireString } from "../../../ipc";
import type { PagesSession } from "./pages-session/pages-session";

// This software is split into two components: the renderer, and the main
// process. Neither can see each other directly, and IPC is the only way to
// relay information among eachother.
//
// This file is the pages side of that: each channel checks what arrives and
// hands it to the session (`pages-session.ts`), which holds the trail and the
// order writes are recorded in. What only Electron can do — sending to the
// windows, the image scheme, the native menu — is here too.

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
 * Sends `state` to every window, over `pages:changed`. A window closing
 * between the read and the send is ordinary, which is the only thing the
 * guard is for.
 */
export function broadcastPages(state: PagesState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(PAGE_CHANNELS.changed, state);
    }
  }
}

/** Registers the pages channels, and the image scheme, against `session`. */
export function registerPageIpc(session: PagesSession): void {
  ipcMain.handle(PAGE_CHANNELS.show, () => session.show());

  ipcMain.handle(PAGE_CHANNELS.go, (_event, place: unknown) => {
    const { page, block } = (place ?? {}) as Record<string, unknown>;
    const next: Place = {
      page: requireTitle(page),
      ...(block === undefined ? {} : { block: requireString(block, "block") }),
    };
    return session.go(next);
  });

  ipcMain.handle(PAGE_CHANNELS.back, () => session.back());

  ipcMain.handle(PAGE_CHANNELS.rezoom, (_event, block: unknown) =>
    session.rezoom(
      block === undefined ? undefined : requireString(block, "block"),
    ),
  );

  ipcMain.handle(PAGE_CHANNELS.locate, (_event, blockId: unknown) =>
    session.locate(requireString(blockId, "blockId")),
  );

  ipcMain.handle(PAGE_CHANNELS.search, (_event, query: unknown) =>
    session.search(requireString(query, "query")),
  );

  ipcMain.handle(PAGE_CHANNELS.status, () => session.status());

  ipcMain.handle(
    PAGE_CHANNELS.addBlock,
    (_event, id: unknown, title: unknown, text: unknown, after: unknown) =>
      session.addBlock(
        requireBlockId(id),
        requireTitle(title),
        requireString(text, "text"),
        // Absent means the end of the page; anything else has to be a block id
        // before it reaches a log that keeps it forever.
        after === undefined ? undefined : requireString(after, "after"),
      ),
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

  // No title on any of these four. The block id is the whole address, so
  // there is nothing to check a title against and nothing to write one into.
  ipcMain.handle(
    PAGE_CHANNELS.editBlock,
    (_event, blockId: unknown, text: unknown) =>
      session.editBlock(
        requireString(blockId, "blockId"),
        requireString(text, "text"),
      ),
  );

  ipcMain.handle(PAGE_CHANNELS.deleteBlock, (_event, blockId: unknown) =>
    session.deleteBlock(requireString(blockId, "blockId")),
  );

  ipcMain.handle(PAGE_CHANNELS.indentBlock, (_event, blockId: unknown) =>
    session.indentBlock(requireString(blockId, "blockId")),
  );

  ipcMain.handle(PAGE_CHANNELS.outdentBlock, (_event, blockId: unknown) =>
    session.outdentBlock(requireString(blockId, "blockId")),
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
