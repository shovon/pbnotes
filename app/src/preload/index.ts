// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { PROJECT_CHANNELS } from '../shared/projects';
import type { ProjectsApi } from '../shared/projects';
import { PAGE_CHANNELS } from '../shared/pages';
import type { PagesApi, PagesState } from '../shared/pages';

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

const pages: PagesApi = {
  show: () => ipcRenderer.invoke(PAGE_CHANNELS.show),
  onChanged: (listener) => {
    // Wrapped rather than handed to `ipcRenderer.on` directly: the first
    // argument of an IPC event is the event itself, which carries `sender`,
    // and the whole point of the bridge is that the renderer never gets that.
    const forward = (_event: IpcRendererEvent, state: PagesState): void =>
      listener(state);
    ipcRenderer.on(PAGE_CHANNELS.changed, forward);
    return () => ipcRenderer.off(PAGE_CHANNELS.changed, forward);
  },
  go: (place) => ipcRenderer.invoke(PAGE_CHANNELS.go, place),
  back: () => ipcRenderer.invoke(PAGE_CHANNELS.back),
  rezoom: (block) => ipcRenderer.invoke(PAGE_CHANNELS.rezoom, block),
  locate: (blockId) => ipcRenderer.invoke(PAGE_CHANNELS.locate, blockId),
  status: () => ipcRenderer.invoke(PAGE_CHANNELS.status),
  addBlock: (title, text, after) =>
    ipcRenderer.invoke(PAGE_CHANNELS.addBlock, title, text, after),
  addImage: (bytes, mime) =>
    ipcRenderer.invoke(PAGE_CHANNELS.addImage, bytes, mime),
  editBlock: (blockId, text) =>
    ipcRenderer.invoke(PAGE_CHANNELS.editBlock, blockId, text),
  deleteBlock: (blockId) =>
    ipcRenderer.invoke(PAGE_CHANNELS.deleteBlock, blockId),
  indentBlock: (blockId) =>
    ipcRenderer.invoke(PAGE_CHANNELS.indentBlock, blockId),
  outdentBlock: (blockId) =>
    ipcRenderer.invoke(PAGE_CHANNELS.outdentBlock, blockId),
  blockMenu: (blockId) => ipcRenderer.invoke(PAGE_CHANNELS.blockMenu, blockId),
};

// Only this explicit surface crosses the context bridge; the renderer never
// sees `ipcRenderer` itself.
contextBridge.exposeInMainWorld('pbnotes', { projects, pages });
