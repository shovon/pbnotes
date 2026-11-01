// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { PROJECT_CHANNELS } from '../shared/projects';
import type { ProjectsApi } from '../shared/projects';
import { PAGE_CHANNELS } from '../shared/pages';
import type { PagesApi } from '../shared/pages';

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
  view: (place, today) => ipcRenderer.invoke(PAGE_CHANNELS.view, place, today),
  // Hands each version on without the event: the first argument of an IPC
  // event carries `sender`, and the whole point of the bridge is that the
  // renderer never gets that.
  onChanged: (listener) => {
    const heard = (_event: IpcRendererEvent, version: number) =>
      listener(version);
    ipcRenderer.on(PAGE_CHANNELS.changed, heard);
    return () => {
      ipcRenderer.off(PAGE_CHANNELS.changed, heard);
    };
  },
  locate: (blockId) => ipcRenderer.invoke(PAGE_CHANNELS.locate, blockId),
  search: (query) => ipcRenderer.invoke(PAGE_CHANNELS.search, query),
  status: () => ipcRenderer.invoke(PAGE_CHANNELS.status),
  run: (command) => ipcRenderer.invoke(PAGE_CHANNELS.command, command),
  addImage: (bytes, mime) =>
    ipcRenderer.invoke(PAGE_CHANNELS.addImage, bytes, mime),
  blockMenu: (blockId) => ipcRenderer.invoke(PAGE_CHANNELS.blockMenu, blockId),
};

// Only this explicit surface crosses the context bridge; the renderer never
// sees `ipcRenderer` itself.
contextBridge.exposeInMainWorld('pbnotes', { projects, pages });
