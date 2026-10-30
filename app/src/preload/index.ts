// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { PROJECT_CHANNELS } from '../shared/projects';
import type { ProjectsApi } from '../shared/projects';
import { PAGE_CHANNELS } from '../shared/pages';
import type { PagesApi, PagesState } from '../shared/pages';
import { createHeard } from './heard/heard';

const projects: ProjectsApi = {
  list: () => ipcRenderer.invoke(PROJECT_CHANNELS.list),
  pick: () => ipcRenderer.invoke(PROJECT_CHANNELS.pick),
  add: (paths) => ipcRenderer.invoke(PROJECT_CHANNELS.add, paths),
  remove: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.remove, id),
  rename: (id, name) => ipcRenderer.invoke(PROJECT_CHANNELS.rename, id, name),
  setPinned: (id, pinned) =>
    ipcRenderer.invoke(PROJECT_CHANNELS.setPinned, id, pinned),
  open: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.open, id),
  current: () => ipcRenderer.invoke(PROJECT_CHANNELS.current),
  relocate: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.relocate, id),
  availability: (ids) => ipcRenderer.invoke(PROJECT_CHANNELS.availability, ids),
  reveal: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.reveal, id),
};

// One listener on the channel for the life of the page, registered before the
// renderer can call anything, so no state goes unnumbered. It hands each state
// on without the event: the first argument of an IPC event carries `sender`,
// and the whole point of the bridge is that the renderer never gets that.
const heard = createHeard<PagesState>();
ipcRenderer.on(
  PAGE_CHANNELS.changed,
  (_event: IpcRendererEvent, state: PagesState, n: number) =>
    heard.deliver(state, n),
);

/**
 * A call that leads to a state: main replies with that state's number, and the
 * call is held until `onChanged` has heard it. See `heard.ts` for why Electron
 * cannot be left to keep that order.
 */
const changes =
  (channel: string) =>
  async (...args: unknown[]): Promise<void> =>
    heard.until(await ipcRenderer.invoke(channel, ...args));

const pages: PagesApi = {
  show: changes(PAGE_CHANNELS.show),
  onChanged: (listener) => heard.listen(listener),
  go: changes(PAGE_CHANNELS.go),
  back: changes(PAGE_CHANNELS.back),
  rezoom: changes(PAGE_CHANNELS.rezoom),
  locate: (blockId) => ipcRenderer.invoke(PAGE_CHANNELS.locate, blockId),
  search: (query) => ipcRenderer.invoke(PAGE_CHANNELS.search, query),
  status: () => ipcRenderer.invoke(PAGE_CHANNELS.status),
  run: changes(PAGE_CHANNELS.command),
  addImage: (bytes, mime) =>
    ipcRenderer.invoke(PAGE_CHANNELS.addImage, bytes, mime),
  blockMenu: (blockId) => ipcRenderer.invoke(PAGE_CHANNELS.blockMenu, blockId),
};

// Only this explicit surface crosses the context bridge; the renderer never
// sees `ipcRenderer` itself.
contextBridge.exposeInMainWorld('pbnotes', { projects, pages });
