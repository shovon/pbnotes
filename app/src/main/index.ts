import { app, BrowserWindow, nativeTheme, protocol, shell } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { closeDatabase, openDatabase } from "./db";
import {
  currentProject,
  registerProjectIpc,
  requireProject,
} from "./features/projects/projects-ipc";
import {
  adoptLedger,
  beforeOpen,
  bindDevice,
  closeLedgers,
  createLedger,
  defineFold,
  deviceOf,
  inspect,
  onArrival,
} from "@pbnotes/ledger";
import type { LedgerRef } from "@pbnotes/ledger";
import {
  deviceId,
  recall,
  remember,
  rotateDeviceId,
} from "./device-store";
import {
  refreshPages,
  registerPageIpc,
  resetTrail,
} from "./features/projects/pages/pages-ipc";
import { pagesFold } from "./features/projects/pages/pages-store/pages-store";
import { findImage, saveImage } from "./features/projects/pages/images/images";
import { IMAGE_SCHEME } from "../shared/pages";
import {
  MIN_SIZE,
  restoreWindowBounds,
  trackWindowState,
} from "./features/window-state/window-state";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Electron names `userData` after `productName`, which is the display name,
// "Pb Notes". The directory stays `pbnotes`: `notes.db` is already there, and
// a display name that changes again must not strand the registry a second
// time. An explicit `--user-data-dir` still wins, so a scratch profile stays
// a scratch profile.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), "pbnotes"));
}

// Every fold the app has, registered here and nowhere else: a feature exports
// its fold and never learns what it was registered with. At module load,
// because a ledger that is already open has replayed without a fold that
// arrives after it.
const pagesOf = defineFold("pages", pagesFold);

/**
 * `<project>/gnotes/`, holding the ledger. Visible, not behind a dot: a
 * dot-directory tells the user "you can safely ignore this", which is true of
 * a tool's bookkeeping and a lie about the only copy of their work.
 *
 * The log lives *inside the project's own directory*, and that location is
 * the point of the whole app. A project folder is where the user's work
 * already lives, so what they write about it belongs beside it: it gets backed
 * up with it, syncs with it, travels with it to another machine, and outlives
 * pbnotes itself. Put it in `userData` instead and wiping an OS support
 * folder — or losing the registry that maps a UUID back to a path — takes the
 * writing with it. The content is the user's, not the app's.
 */
function logDirectory(projectPath: string): string {
  return path.join(projectPath, "gnotes");
}

/** A project as the ledger knows it: its id, and where its log is kept. */
function ledgerOf(project: { id: string; path: string }): LedgerRef {
  return { id: project.id, path: logDirectory(project.path) };
}

// Before the app is ready, or it is too late. `standard` gives the URL a
// host, which is always `images`; the handler is in `pages-ipc`.
protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } },
]);

const createWindow = () => {
  const { maximized, ...bounds } = restoreWindowBounds();

  const mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    // An empty window painted before the renderer has anything to show reads
    // as a flash of the wrong colour, so it is not shown until it has content,
    // and what it paints underneath matches the app's own background rather
    // than Electron's white.
    show: false,
    // No title bar: the window controls hover over the page instead. Nothing
    // ever lived up there but the app's own name, and the page is the app.
    // `titleBarOverlay` is what gives Windows and Linux their controls back.
    titleBarStyle: "hiddenInset",
    titleBarOverlay: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b1d" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (maximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  trackWindowState(mainWindow);

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  /**
   * Notes are Markdown, so they can carry links. A link must never navigate
   * the window away from the app — there is no way back from a renderer that
   * has left — so anything outward opens in the real browser instead.
   */
  const openExternally = (url: string) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === mainWindow.webContents.getURL()) return;
    event.preventDefault();
    openExternally(url);
  });

  // Only while developing. A packaged app that opens with the inspector
  // showing has given away half its window to something the user cannot use.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  openDatabase();
  // Who we are in a shared log folder, and what we remember about it. Has to
  // happen before any log is opened: a device that appends before it knows its
  // own identity writes in somebody else's directory.
  bindDevice({
    device: deviceId(),
    recall,
    remember,
    rotate: rotateDeviceId,
  });
  // A log opens only on a folder that holds a `LEDGER` marker, and never
  // makes one. What a project's `gnotes/` gets before it is opened is decided
  // here: a folder nothing has been written in is made a ledger, because that
  // is what picking a new project means. Anything else that is not one is
  // left alone, and the open that follows refuses it and says why.
  beforeOpen(async (directory) => {
    const found = await inspect(directory);
    if (found === "missing") await createLedger(directory);
    // Temporary (#36). Every folder written before markers holds segments and
    // no `LEDGER`, so for now one is written without asking. Once those have
    // been opened by a build with this in it, this line goes and an unmarked
    // folder is adopted only when the user says so.
    if (found === "unmarked") await adoptLedger(directory);
  });
  // A different project is open, so a trail through the last one is over.
  registerProjectIpc(resetTrail);
  // Pages are handed their view of what is open, and the images beside it,
  // and never ask what that is. This is the one place that says it is the
  // open project's, and the one place that turns a project into a path.
  //
  // `requireProject` settles which project before its first `await`, and is
  // the first thing each of these calls: a write or an image sent just before
  // the project changed lands where it was sent.
  registerPageIpc({
    require: async () => pagesOf(ledgerOf(await requireProject())),
    saveImage: async (bytes, mime) => {
      const project = await requireProject();
      return saveImage(
        logDirectory(project.path),
        await deviceOf(ledgerOf(project)),
        bytes,
        mime,
      );
    },
    // `currentProject`, not `requireProject`: this only reads. `findImage`
    // lists directories and creates none, so an unmounted drive is an image
    // that is not found, not a path invented on the local disk.
    findImage: async (name) => {
      const project = currentProject();
      return project
        ? findImage(logDirectory(project.path), name)
        : undefined;
    },
  });
  // Another device's events landed in a project's folder. Every fold has taken
  // them in by now, so nothing is fed to a feature here: each one is only told
  // to draw again, and only when the project is the one on screen — which is
  // settled here, so no feature has to ask. The ledger holds one listener, and
  // this is it — a new feature adds its line here.
  onArrival((projectId) => {
    if (currentProject()?.id !== projectId) return;
    refreshPages();
  });
  createWindow();
});

app.on("will-quit", () => {
  closeDatabase();
  // Best effort, and that is enough: every append is fsynced before it is
  // acknowledged, so a log left unclosed has already lost nothing.
  void closeLedgers();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
