import { BrowserWindow, ipcMain } from "electron";
import type { Menu } from "electron";
import { WINDOW_CHANNELS } from "../../../shared/window";
import { readPoint } from "../../ipc";

/**
 * The window channels, each something only Electron can do, so they stay
 * here:
 *
 * - closing the window that sent the call, through `close()`, so its
 *   `close` event fires and window-state keeps its size and place;
 * - popping up `menu`, the app's menu, at the titlebar's ⋮ button (#341),
 *   where Windows and Linux have no menu bar. It is the same template the
 *   application menu is built from, so a pick runs exactly what the menu bar
 *   would, and settles once the menu closes.
 */
export function registerWindowIpc(menu: Menu): void {
  ipcMain.handle(WINDOW_CHANNELS.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(WINDOW_CHANNELS.menu, (event, at: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return new Promise<void>((resolve) => {
      menu.popup({ window, ...readPoint(at), callback: () => resolve() });
    });
  });
}
