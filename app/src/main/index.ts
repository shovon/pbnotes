// Composition root for the main process. Everything that holds state is
// built here, handed to what needs it, and closed here. No other module keeps
// a handle of its own.
import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  protocol,
  screen,
  shell,
} from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import started from "electron-squirrel-startup";
import { openDatabase } from "./db";
import { appMenu } from "./features/menu/menu";
import { createOpenBench } from "./features/bench/bench";
import { registerBenchIpc } from "./features/bench/bench-ipc";
import { registerWindowIpc } from "./features/window/window-ipc";
import { WINDOW_CHANNELS } from "../shared/window";
import { benchFiles } from "./features/bench/bench-store";
import { sidebarSlots } from "./features/sidebar/sidebar-slots";
import { iconSlots } from "./features/icons/icon-slots/icon-slots";
import { rendererSource } from "./renderer-source/renderer-source";
import {
  mainWindowOptions,
  windowColors,
} from "./window-options/window-options";
import { createDisk } from "./features/projects/disk/disk";
import {
  createProjectsStore,
  pathKeyOn,
} from "./features/projects/projects-store";
import { registerProjectIpc } from "./features/projects/projects-ipc";
import { createOpenProject } from "./features/projects/open-project/open-project";
import { createInFlight } from "./in-flight";
import { createLedgers } from "./ledgers";
import {
  broadcastGraph,
  registerGraphIpc,
} from "./features/projects/graph/graph-ipc";
import { createGraphSession } from "./features/projects/graph/graph-session/graph-session";
import { carryImages, findImage, saveImage } from "./features/projects/graph/images/images";
import { createTokens } from "./tokens";
import { GRAPH_CHANNELS, IMAGE_SCHEME } from "../shared/graph";
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
// host, which is always `images`; the handler is in `graph-ipc`.
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
    // `hiddenInset` is macOS's alone: Windows ignores it and keeps its own
    // title bar, so there it is `hidden` (#341).
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
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

  // Windows and Linux would draw the menu as a bar of its own above the
  // page, under the strip the tabs and window controls share. The titlebar's
  // ⋮ button opens it instead (#341). Hidden, not removed, so its shortcuts
  // still work, and not auto-hidden, so Alt does not bring the bar back:
  // Alt opens the ⋮ menu instead. macOS keeps its menu in the menu bar.
  if (process.platform !== "darwin") mainWindow.setMenuBarVisibility(false);

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
  // The app's own menu (#247): Electron's default, but with Undo and Redo
  // telling the focused window, which decides whether the open field or
  // main takes the step. The default's would call the browser's undo. The
  // tab items (#304) tell the focused window too.
  const menu = appMenu(
    process.platform === "darwin",
    (way) => BrowserWindow.getFocusedWindow()?.webContents.send(GRAPH_CHANNELS.take, way),
    // The tab items (#304) the same way: the window holds its tabs.
    (item) => BrowserWindow.getFocusedWindow()?.webContents.send(WINDOW_CHANNELS.tab, item),
  );
  // Set even where the menu bar is hidden (#341): the shortcuts are the
  // application menu's, and a window with none has no Ctrl+T or Ctrl+Z.
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
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
  // Every call that may reach a ledger, from the moment it is sent until it
  // is done: a read, a write, a stored image. A change of project waits for
  // what was sent before it, so a ledger is closed under none of them, and
  // none opens one again after it was closed.
  const inFlight = createInFlight();

  // What main holds per project that a change of project has to clear: the
  // open project's bench file, let go so the next call opens the new one's,
  // undo's history (#234), so Cmd+Z never reaches back into the project left,
  // and every ledger but the new one's, with the log and the graph each holds
  // (#236), once the calls sent before the change are done. Kept is what is
  // open then, so a quick switch back keeps the project it went back to. The
  // trail is each window's, and `App` remounts the project view when the
  // project changes. A feature that holds something gets a line here. `graph`
  // is made below; this only runs once the app is up.
  const projects = createOpenProject(store, disk.probe, () => {
    bench.release();
    graph.forget();
    void inFlight
      .settled()
      .then(() => ledgers.keepOnly(projects.currentProject()?.id));
  });
  registerProjectIpc(store, projects);

  // The bench: this machine's state that only means something to the
  // product, one file per project in `userData/bench/` (DNA.md, "The
  // bench"), so no handle reaches more than one project. It is told the open
  // project by `currentProject`, not `requireProject`: it lives in
  // `userData`, so a project whose folder can't be reached still has its
  // bench. The product declares its slots here: the sidebar's (#184), and
  // the emoji picked lately for page icons (#323).
  const bench = createOpenBench(
    benchFiles(path.join(app.getPath("userData"), "bench")),
    new Map([...sidebarSlots, ...iconSlots]),
    () => projects.currentProject()?.id,
  );
  registerBenchIpc(bench);
  // A window closing itself, as its last tab closes (#303), and the app's
  // menu opened from the titlebar's ⋮ button (#341): a second copy of the
  // same template, since the application menu is the menu bar's own.
  registerWindowIpc(Menu.buildFromTemplate(menu));

  // The graph is handed its view of what is open, and the images beside it,
  // and never ask what that is. This is the one place that says it is the
  // open project's, and the one place that turns a project into a path.
  //
  // `requireProject` settles which project before its first `await`, and is
  // the first thing a read, a write or a stored image calls: one sent just
  // before the project changed lands where it was sent. Each is tracked as it
  // is sent; a write is tracked until it is recorded, as it waits its turn
  // after `require` has resolved.
  const graph = createGraphSession(
    {
      require: () =>
        inFlight.track(
          (async () => ledgers.graphOf(await projects.requireProject()))(),
        ),
    },
    // Every window of the app, over `graph:changed`.
    broadcastGraph,
  );
  // What the tokens a copy carries for its images stand for (#261): a
  // project id, kept in main and never sent. The latest few, for this run.
  const imageSources = createTokens<string>({ newId: randomUUID, keep: 50 });
  registerGraphIpc(
    { ...graph, run: (command) => inFlight.track(graph.run(command)) },
    {
      save: (bytes, mime) =>
        inFlight.track(
          (async () => {
            const project = await projects.requireProject();
            return saveImage(
              project.path,
              await ledgers.writerOf(project),
              bytes,
              mime,
            );
          })(),
        ),
      // `currentProject`, not `requireProject`: this only reads. `findImage`
      // lists directories and creates none, so an unmounted drive is an image
      // that is not found, not a path invented on the local disk.
      find: async (name) => {
        const project = projects.currentProject();
        return project ? findImage(project.path, name) : undefined;
      },
      // A copy whose images are too big to carry names where they are by a
      // token (#261), lent here, for the project's id: a project that moves
      // keeps it, and one removed since stands for nothing.
      source: async () => {
        const project = projects.currentProject();
        return project ? imageSources.lend(project.id) : undefined;
      },
      // Tracked like `save`: `writerOf` opens the ledger, so a carry sent just
      // before a change of project must be done before that ledger is closed.
      carry: (wanted, source) =>
        inFlight.track(
          (async () => {
            const project = await projects.requireProject();
            const id = source === undefined ? undefined : imageSources.find(source);
            const from = id === undefined ? undefined : store.getProject(id)?.path;
            return carryImages(project.path, await ledgers.writerOf(project), from, wanted);
          })(),
        ),
    },
  );

  // A project's graph moved: a write of ours, another session's events
  // landing in its folder, or the fold catching up with a write of ours. Every
  // fold has taken them in by now, so nothing is fed to a feature here: each
  // one is only told to tell the windows, and only when the project is the one on screen — which is settled
  // here, so no feature has to ask. The ledgers hold one listener, and this
  // is it — a new feature adds its line here.
  ledgers.onChange((projectId) => {
    if (projects.currentProject()?.id !== projectId) return;
    graph.refreshGraph();
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
    bench.release();
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
