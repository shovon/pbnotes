/**
 * The app's menu (#247): Electron's default, item for item, except that
 * Undo and Redo are the app's own. The default's Undo calls the browser's
 * undo (`role: 'undo'`), which Chromium keeps for the whole page and knows
 * nothing of the graph; the app's tells the focused window instead, and the
 * window's dispatcher decides whether the open field or main takes the step.
 *
 * A pure template, so it runs under `node --test`; `index.ts` builds the
 * menu from it and says what `take` does.
 *
 * Left out of the default: its Help menu, whose items are links to
 * Electron's own website and community, not this app's.
 */
import type { MenuItemConstructorOptions } from "electron";

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
 * The menu for the platform: on macOS the app menu first, as every Mac app
 * has. `take` is called with the way when Undo or Redo is chosen, by menu or
 * by its key.
 */
export function appMenu(mac: boolean, take: (way: Way) => void): MenuItemConstructorOptions[] {
  return [
    ...(mac ? [{ role: "appMenu" } satisfies MenuItemConstructorOptions] : []),
    { role: "fileMenu" },
    edit(mac, take),
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}
