import { BrowserWindow, Menu, ipcMain } from "electron";
import { SIDEBAR_CHANNELS } from "../../../shared/sidebar";
import type { RecentMenuPick } from "../../../shared/sidebar";
import { readPoint } from "../../ipc";

/**
 * The sidebar's channels: only what Electron alone can do, which is drawing
 * a native menu.
 *
 * A Recent entry's menu (#366) holds one item, Remove from Recent. What it
 * does is the window's: Recent is kept on the bench, which the window
 * already writes, and removing an entry writes nothing to the project. The
 * reply settles the way the page menu's does: on the first of a `click`
 * and the menu closing, with the close a moment late, since which of the
 * two the platform reports first is not promised.
 */
export function registerSidebarIpc(): void {
  ipcMain.handle(SIDEBAR_CHANNELS.recentMenu, (event, at: unknown) => {
    const point = readPoint(at);
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return new Promise<RecentMenuPick | null>((resolve) => {
      Menu.buildFromTemplate([
        { label: "Remove from Recent", click: () => resolve("remove") },
      ]).popup({
        window,
        ...point,
        callback: () => setTimeout(() => resolve(null), 100),
      });
    });
  });
}
