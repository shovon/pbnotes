// Composition root for the main process. Everything that holds state is
// built here, handed to what needs it, and closed here. No other module keeps
// a handle of its own.
import {
  app,
  BrowserWindow,
  nativeTheme,
  protocol,
  screen,
  shell,
} from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import started from "electron-squirrel-startup";
import { openDatabase } from "./db";
import { rendererSource } from "./renderer-source/renderer-source";
import { mainWindowOptions, windowColors } from "./window-options/window-options";
import { createDisk } from "./features/projects/disk/disk";
import {
  createProjectsStore,
  pathKeyOn,
} from "./features/projects/projects-store";
import { registerProjectIpc } from "./features/projects/projects-ipc";
import { createOpenProject } from "./features/projects/open-project/open-project";
import { createLedgers } from "./ledgers";
import {
  broadcastPages,
  registerPageIpc,
} from "./features/projects/pages/pages-ipc";
import { createPagesSession } from "./features/projects/pages/pages-session/pages-session";
import { findImage, saveImage } from "./features/projects/pages/images/images";
import { IMAGE_SCHEME } from "../shared/pages";
import {
  MIN_SIZE,
  createWindowState,
} from "./features/window-state/window-state";
import type { WindowState } from "./features/window-state/window-state";

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

// Before the app is ready, or it is too late. `standard` gives the URL a
// host, which is always `images`; the handler is in `pages-ipc`.
protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } },
]);

const createWindow = (windowState: WindowState) => {
  const { maximized, ...bounds } = windowState.restoreWindowBounds();
  const colors = windowColors(nativeTheme.shouldUseDarkColors);

  const mainWindow = new BrowserWindow({
    // Secure defaults first (isolation, sandbox, the preload), then the size.
    ...mainWindowOptions({ preload: path.join(__dirname, "preload.js") }),
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
    // `titleBarOverlay` is what gives Windows and Linux their controls back,
    // painted in the top strip's own colours so they sit in it rather than
    // on it. macOS draws its traffic lights on whatever is there.
    titleBarStyle: "hiddenInset",
    titleBarOverlay: colors.titleBarOverlay,
    backgroundColor: colors.backgroundColor,
  });

  // The page follows the system theme by itself; what the window paints
  // around it has to be told.
  const followTheme = () => {
    const next = windowColors(nativeTheme.shouldUseDarkColors);
    mainWindow.setBackgroundColor(next.backgroundColor);
    if (process.platform !== "darwin")
      mainWindow.setTitleBarOverlay(next.titleBarOverlay);
  };
  nativeTheme.on("updated", followTheme);
  mainWindow.once("closed", () => nativeTheme.off("updated", followTheme));

  if (maximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  windowState.trackWindowState(mainWindow);

  const source = rendererSource(
    MAIN_WINDOW_VITE_DEV_SERVER_URL,
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  );
  void (source.kind === "url"
    ? mainWindow.loadURL(source.url)
    : mainWindow.loadFile(source.path));

  /**
   * Notes are Markdown, so they can carry links. A link must never navigate
   * the window away from the app — there is no way back from a renderer that
   * has left — so anything outward opens in the real browser instead, and a
   * bare email address, which becomes a `mailto:` link, in the mail app.
   */
  const openExternally = (url: string) => {
    if (/^(https?:\/\/|mailto:)/.test(url)) {
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
  if (source.kind === "url") mainWindow.webContents.openDevTools();
};

// Some APIs can only be used once Electron is ready, so everything is built
// here, and the handlers that need what was built are attached here too.
app.on("ready", () => {
  const db = openDatabase(path.join(app.getPath("userData"), "notes.db"));
  // The displays attached now: `screen` is only usable once the app is ready.
  const windowState = createWindowState(
    db,
    (saved) =>
      (saved ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay())
        .workArea,
  );
  const ledgers = createLedgers();
  // The real clock and the real disk, chosen here and nowhere else. The clock
  // dates an add or an open; which page is today is each window's clock.
  const now = () => new Date();
  const disk = createDisk();

  const store = createProjectsStore(db, {
    disk,
    now,
    newId: randomUUID,
    pathKey: pathKeyOn(process.platform),
  });
  // Nothing in main holds anything per project that a change of project has
  // to clear: the trail is each window's, and `App` remounts the project view
  // when the project changes. A feature that does hold something gets a line
  // here.
  const projects = createOpenProject(store, disk.probe, () => undefined);
  registerProjectIpc(store, projects);

  // Pages are handed their view of what is open, and the images beside it,
  // and never ask what that is. This is the one place that says it is the
  // open project's, and the one place that turns a project into a path.
  //
  // `requireProject` settles which project before its first `await`, and is
  // the first thing a read, a write or a stored image calls: one sent just
  // before the project changed lands where it was sent.
  const pages = createPagesSession(
    { require: async () => ledgers.pagesOf(await projects.requireProject()) },
    // Every window of the app, over `pages:changed`.
    broadcastPages,
  );
  registerPageIpc(pages, {
    save: async (bytes, mime) => {
      const project = await projects.requireProject();
      return saveImage(
        project.path,
        await ledgers.writerOf(project),
        bytes,
        mime,
      );
    },
    // `currentProject`, not `requireProject`: this only reads. `findImage`
    // lists directories and creates none, so an unmounted drive is an image
    // that is not found, not a path invented on the local disk.
    find: async (name) => {
      const project = projects.currentProject();
      return project ? findImage(project.path, name) : undefined;
    },
  });

  // A project's pages moved: a write of ours, another session's events
  // landing in its folder, or the fold catching up with a write of ours. Every
  // fold has taken them in by now, so nothing is fed to a feature here: each
  // one is only told to tell the windows, and only when the project is the one on screen — which is settled
  // here, so no feature has to ask. The ledgers hold one listener, and this
  // is it — a new feature adds its line here.
  ledgers.onChange((projectId) => {
    if (projects.currentProject()?.id !== projectId) return;
    pages.refreshPages();
  });

  // The folders are read less often while no window of the app has focus,
  // and the open project's in full the moment one gains it. Switching between
  // two of its windows blurs one and focuses the other, which only costs one
  // extra read.
  app.on("browser-window-focus", () =>
    ledgers.setFocused(true, projects.currentProject()?.id),
  );
  app.on("browser-window-blur", () => ledgers.setFocused(false));

  createWindow(windowState);

  app.on("activate", () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(windowState);
    }
  });

  app.on("will-quit", () => {
    db.close();
    // Best effort, and that is enough: every append is fsynced before it is
    // acknowledged, so a log left unclosed has already lost nothing.
    void ledgers.close();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
