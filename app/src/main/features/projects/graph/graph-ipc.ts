import {
  BrowserWindow,
  ClipboardItem,
  Menu,
  clipboard,
  ipcMain,
  net,
  protocol,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CARRY_COUNT, CARRY_LIMIT, IMAGE_SCHEME, GRAPH_CHANNELS } from "../../../../shared/graph";
import type { BlockMenuPick, CarriedImage, Clip, FilterPick, PageMenuPick, Place } from "../../../../shared/graph";
import { readPoint, requireString, requireStringArray } from "../../../ipc";
import { cutLabel, deleteLabel, readOffer } from "./block-menu/block-menu";
import { readOffer as readPageOffer } from "./page-menu/page-menu";
import { requireCommand, requireDay, requireTitle } from "./command/command";
import { markersOf, requireFilter } from "./filter/filter";
import type { GraphSession } from "./graph-session/graph-session";
import { mimeOf } from "./images/images";

// This software is split into two components: the renderer, and the main
// process. Neither can see each other directly, and IPC is the only way to
// relay information among eachother.
//
// This file is the graph side of that: each channel checks what arrives and
// hands it to the session (`graph-session.ts`), which answers what shows at
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
  /** A token for the images of what is open, or undefined with nothing open. */
  source(): Promise<string | undefined>;
  /**
   * Brings `images` into what is open, from their bytes or from the project
   * `source` stands for, and answers each one's link or undefined.
   */
  carry(images: readonly CarriedImage[], source: string | undefined): Promise<(string | undefined)[]>;
};

/**
 * Tells every window the fold's version, over `graph:changed`; each asks
 * again for the place it is on. A window closing between the read and the
 * send is ordinary, which is the only thing the guard is for.
 */
export function broadcastGraph(version: number): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(GRAPH_CHANNELS.changed, version);
    }
  }
}

/** The images a paste asks for, built fresh from what each reads. */
function requireCarried(value: unknown): CarriedImage[] {
  if (!Array.isArray(value)) throw new TypeError("Expected images to be an array");
  if (value.length > CARRY_COUNT) throw new TypeError("Too many images to bring");
  return value.map((it: unknown) => {
    if (typeof it !== "object" || it === null) throw new TypeError("Expected an image");
    const { name, bytes, mime } = it as Record<string, unknown>;
    if (bytes === undefined) return { name: requireString(name, "name") };
    if (!(bytes instanceof Uint8Array) || bytes.length > CARRY_LIMIT) {
      throw new TypeError("Expected an image's bytes, within the limit");
    }
    return { name: requireString(name, "name"), bytes, mime: requireString(mime, "mime") };
  });
}

/** A copy as it crossed the bridge: its text and its HTML, nothing else. */
function requireClip(clip: unknown): Clip {
  if (typeof clip !== "object" || clip === null) throw new TypeError("Expected a copy");
  const { text, html } = clip as Record<string, unknown>;
  return { text: requireString(text, "text"), html: requireString(html, "html") };
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
 * Registers the graph channels against `session`, and the image channel and
 * scheme against `images`.
 */
export function registerGraphIpc(session: GraphSession, images: Images): void {
  // How far the view's list is loaded: a day on the journal (#282), a
  // title on a page (#285). Any string for a title: it is only compared,
  // and it is the spelling a link gave a page, which a title check could refuse.
  ipcMain.handle(GRAPH_CHANNELS.view, (_event, place: unknown, today: unknown, through: unknown) => {
    const at = requirePlace(place);
    return session.view(
      at,
      requireDay(today),
      through === undefined || through === null
        ? undefined
        : at ? requireString(through, "through") : requireDay(through, "through"),
    );
  });

  ipcMain.handle(GRAPH_CHANNELS.locate, (_event, blockId: unknown) =>
    session.locate(requireString(blockId, "blockId")),
  );

  ipcMain.handle(GRAPH_CHANNELS.renamed, (_event, names: unknown) =>
    session.renamed(requireStringArray(names, "names")),
  );

  ipcMain.handle(GRAPH_CHANNELS.icons, (_event, titles: unknown) =>
    session.icons(requireStringArray(titles, "titles")),
  );

  ipcMain.handle(GRAPH_CHANNELS.search, (_event, query: unknown) =>
    session.search(requireString(query, "query")),
  );

  ipcMain.handle(GRAPH_CHANNELS.aliasing, (_event, page: unknown, alias: unknown) =>
    session.aliasing(requireString(page, "page"), requireString(alias, "alias")),
  );

  ipcMain.handle(GRAPH_CHANNELS.find, (_event, query: unknown) =>
    session.find(requireString(query, "query")),
  );

  ipcMain.handle(GRAPH_CHANNELS.pages, () => session.pages());

  // The graph view's (#183): throwaway, with `@pbnotes/graph/link-map`.
  ipcMain.handle(GRAPH_CHANNELS.linkMap, () => session.linkMap());
  ipcMain.handle(GRAPH_CHANNELS.blockPreviews, (_event, ids: unknown) =>
    session.blockPreviews(requireStringArray(ids, "ids")),
  );

  // Every task that meets a filter (#387), loaded `through` a title: any
  // string, as a page's linked references take, since it is only compared.
  ipcMain.handle(GRAPH_CHANNELS.tasks, (_event, filter: unknown, through: unknown) =>
    session.tasks(
      requireFilter(filter),
      through === undefined || through === null ? undefined : requireString(through, "through"),
    ),
  );

  ipcMain.handle(GRAPH_CHANNELS.status, () => session.status());

  // Every write, on one channel (#158): the command's shape is checked
  // here, and the session runs the package command it names.
  ipcMain.handle(GRAPH_CHANNELS.command, (_event, command: unknown) =>
    session.run(requireCommand(command)),
  );

  ipcMain.handle(
    GRAPH_CHANNELS.addImage,
    (_event, bytes: unknown, mime: unknown) => {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("Expected bytes to be a Uint8Array");
      }
      return images.save(bytes, requireString(mime, "mime"));
    },
  );

  // An image's bytes, for a copy that carries it (#261). Found as the scheme
  // below finds one, so the name is checked by `find` before it is near a
  // path, and typed by its extension, which is what it was stored under.
  ipcMain.handle(GRAPH_CHANNELS.image, async (_event, name: unknown) => {
    const file = await images.find(requireString(name, "name"));
    const mime = file && mimeOf(file);
    if (!file || !mime) return undefined;
    return { bytes: new Uint8Array(await readFile(file)), mime };
  });

  // A token for where the open project's images are (#261). What it stands
  // for stays in main: `index.ts` keeps it, and the window only carries it.
  ipcMain.handle(GRAPH_CHANNELS.imageSource, () => images.source());

  // The images a paste links, brought into what is open (#261). What
  // arrives came off a clipboard any app can write: each name is checked by
  // `find` before it is near a path, the bytes by their size here and their
  // type when stored, and a token main never handed out stands for nothing.
  ipcMain.handle(GRAPH_CHANNELS.carryImages, (_event, wanted: unknown, source: unknown) =>
    images.carry(
      requireCarried(wanted),
      source === undefined ? undefined : requireString(source, "source"),
    ),
  );

  // One copy in two formats (#261), written in one go so whatever pastes it
  // picks the one it reads. Here, not in the window, so the copy does not
  // depend on the window holding focus while it was put together.
  ipcMain.handle(GRAPH_CHANNELS.copy, (_event, clip: unknown) => {
    const { text, html } = requireClip(clip);
    return clipboard.write([new ClipboardItem({ "text/plain": text, "text/html": html })]);
  });

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
    GRAPH_CHANNELS.blockMenu,
    (event, blockId: unknown, offer: unknown) => {
      const id = requireString(blockId, "blockId");
      const offered = readOffer(offer);
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      return new Promise<BlockMenuPick | null>((resolve) => {
        const items: MenuItemConstructorOptions[] =
          offered.reference === false
            ? []
            : [
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
            ...(items.length > 0 ? [{ type: "separator" as const }] : []),
            // Cut takes the blocks off the page, as delete does (#246).
            {
              label: cutLabel(offered),
              click: () => resolve("cut"),
            },
            {
              label: deleteLabel(offered),
              click: () => resolve("delete"),
            },
          );
        }
        if (items.length === 0) return resolve(null);
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
    GRAPH_CHANNELS.pageMenu,
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
  // What can be added to a filter (#387), from its `+ Filter`: each kind of
  // condition, with what it takes under it, ticked for what the filter
  // holds. Settles the way the page menu's does.
  ipcMain.handle(GRAPH_CHANNELS.filterMenu, (event, at: unknown, filter: unknown) => {
    const point = readPoint(at);
    const held = requireFilter(filter);
    const markers = markersOf(held);
    const marked = held.some((it) => it.kind === "marker");
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return new Promise<FilterPick | null>((resolve) => {
      Menu.buildFromTemplate([
        {
          label: "Marker",
          submenu: (["TODO", "DOING", "DONE"] as const).map((marker) => ({
            label: marker,
            type: "checkbox",
            // No marker condition is every marker, but none is picked yet.
            checked: marked && markers.has(marker),
            click: () => resolve({ kind: "marker", marker }),
          })),
        },
      ]).popup({
        window,
        ...point,
        callback: () => setTimeout(() => resolve(null), 100),
      });
    });
  });
}
