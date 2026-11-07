import { BrowserWindow, ipcMain } from "electron";
import { WINDOW_CHANNELS } from "../../../shared/window";

/**
 * The window channels: closing the window that sent the call, through
 * `close()`, so its `close` event fires and window-state keeps its size
 * and place. Electron alone can do that, so it stays here, and there is
 * nothing to hand in.
 */
export function registerWindowIpc(): void {
  ipcMain.handle(WINDOW_CHANNELS.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
