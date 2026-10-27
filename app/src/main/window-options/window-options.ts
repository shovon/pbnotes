import type { BrowserWindowConstructorOptions } from 'electron'

// Pure: secure defaults for the main window. Only the preload path varies.
export const mainWindowOptions = (
  paths: Readonly<{ preload: string }>
): BrowserWindowConstructorOptions => ({
  width: 900,
  height: 640,
  webPreferences: {
    preload: paths.preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
})
