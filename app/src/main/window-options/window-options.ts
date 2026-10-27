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

export type WindowColors = Readonly<{
  backgroundColor: string
  titleBarOverlay: Readonly<{ color: string; symbolColor: string }>
}>

// Pure: the colours the window paints itself, outside the page: what shows
// before the page has, and the Windows and Linux window controls, which sit
// over the top strip and so must match it. These are the renderer's `bg` and
// `fg` tokens (`renderer/index.css`), repeated because the main process
// cannot read them — change one, change the other.
export const windowColors = (dark: boolean): WindowColors => {
  const [bg, fg] = dark ? ['#1b1b1d', '#ececee'] : ['#ffffff', '#1c1c1e']
  return { backgroundColor: bg, titleBarOverlay: { color: bg, symbolColor: fg } }
}
