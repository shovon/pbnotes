/**
 * The app's menu (#247): Electron's default, item for item, except that
 * Undo and Redo are the app's own, and so are the tab items (#304). The
 * default's Undo calls the browser's undo (`role: 'undo'`), which Chromium
 * keeps for the whole page and knows nothing of the graph; the app's tells
 * the focused window instead, and the window's dispatcher decides whether
 * the open field or main takes the step.
 *
 * The tab items tell the focused window too, which holds the tabs: New Tab
 * in the File menu, Close Tab, Next Tab and Previous Tab in the Window menu.
 * Close Tab takes Cmd/Ctrl+W, so the File and Window menus are spelled out
 * rather than left to their roles, whose Close Window holds that key; Close
 * Window keeps its place on Shift+Cmd/Ctrl+W.
 *
 * A pure template, so it runs under `node --test`; `index.ts` builds the
 * menu from it and says what `take` and `tab` do.
 *
 * Left out of the default: its Help menu, whose items are links to
 * Electron's own website and community, not this app's.
 */
import type { MenuItemConstructorOptions } from "electron";
import type { TabItem } from "../../../shared/window";

/** Which way: back through what was written, or forward through what was undone. */
export type Way = "undo" | "redo";

/** The Edit menu: the default's, with the app's own Undo and Redo. */
function edit(mac: boolean, take: (way: Way) => void): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => take("undo") },
      { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: () => take("redo") },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      ...(mac
        ? ([
            { role: "pasteAndMatchStyle" },
            { role: "delete" },
            { role: "selectAll" },
            { type: "separator" },
            { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] },
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { role: "delete" },
            { type: "separator" },
            { role: "selectAll" },
          ] satisfies MenuItemConstructorOptions[])),
    ],
  };
}

/**
 * The File menu: New Tab, then the default's own. On macOS that is Close
 * Window, moved off Cmd+W to Shift+Cmd+W; elsewhere Quit, and Close Window
 * is in the Window menu, as the default has it.
 */
function file(mac: boolean, tab: (item: TabItem) => void): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [
      { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => tab("new") },
      { type: "separator" },
      mac ? { role: "close", accelerator: "Shift+Cmd+W" } : { role: "quit" },
    ],
  };
}

/**
 * The Window menu: the default's, with the tab items beside Minimize and
 * Zoom. Next and Previous Tab are Ctrl+Tab on every platform, as in a
 * browser: Cmd+Tab on macOS switches apps.
 */
function window(mac: boolean, tab: (item: TabItem) => void): MenuItemConstructorOptions {
  const tabs: MenuItemConstructorOptions[] = [
    { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => tab("close") },
    { label: "Next Tab", accelerator: "Ctrl+Tab", click: () => tab("next") },
    { label: "Previous Tab", accelerator: "Ctrl+Shift+Tab", click: () => tab("previous") },
  ];
  return {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      ...tabs,
      { type: "separator" },
      ...(mac
        ? ([{ role: "front" }, { type: "separator" }, { role: "window" }] satisfies MenuItemConstructorOptions[])
        : ([{ role: "close", accelerator: "Shift+Ctrl+W" }] satisfies MenuItemConstructorOptions[])),
    ],
  };
}

/**
 * The menu for the platform: on macOS the app menu first, as every Mac app
 * has. `take` is called with the way when Undo or Redo is chosen, and `tab`
 * with the item when a tab item is, by menu or by its key.
 */
export function appMenu(
  mac: boolean,
  take: (way: Way) => void,
  tab: (item: TabItem) => void,
): MenuItemConstructorOptions[] {
  return [
    ...(mac ? [{ role: "appMenu" } satisfies MenuItemConstructorOptions] : []),
    file(mac, tab),
    edit(mac, take),
    { role: "viewMenu" },
    window(mac, tab),
  ];
}
