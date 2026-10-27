export type RendererSource =
  | Readonly<{ kind: 'url'; url: string }>
  | Readonly<{ kind: 'file'; path: string }>

// Pure: dev server URL when electron-vite provides one, else the built file.
export const rendererSource = (
  devServerUrl: string | undefined,
  builtIndexPath: string
): RendererSource =>
  devServerUrl ? { kind: 'url', url: devServerUrl } : { kind: 'file', path: builtIndexPath }
