import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { closeDatabase, openDatabase } from './db';
import { registerProjectIpc } from './projects-ipc';
import { bindDevice, closePages } from './pages-store';
import { deviceId, recall, remember, rotateDeviceId } from './device-store';
import { registerPageIpc } from './pages-ipc';
import {
  MIN_SIZE,
  restoreWindowBounds,
  trackWindowState,
} from './window-state';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1d' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
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
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
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
app.on('ready', () => {
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
  registerProjectIpc();
  registerPageIpc();
  createWindow();
});

app.on('will-quit', () => {
  closeDatabase();
  // Best effort, and that is enough: every append is fsynced before it is
  // acknowledged, so a log left unclosed has already lost nothing.
  void closePages();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
