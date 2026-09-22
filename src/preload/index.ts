// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
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
  touch: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.touch, id),
  relocate: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.relocate, id),
  availability: (ids) => ipcRenderer.invoke(PROJECT_CHANNELS.availability, ids),
  reveal: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.reveal, id),
};

const pages: PagesApi = {
  open: (projectId, date) =>
    ipcRenderer.invoke(PAGE_CHANNELS.open, projectId, date),
  addBlock: (projectId, date, text, after) =>
    ipcRenderer.invoke(PAGE_CHANNELS.addBlock, projectId, date, text, after),
  editBlock: (projectId, date, blockId, text) =>
    ipcRenderer.invoke(PAGE_CHANNELS.editBlock, projectId, date, blockId, text),
};

// Only this explicit surface crosses the context bridge; the renderer never
// sees `ipcRenderer` itself.
contextBridge.exposeInMainWorld('gnotes', { projects, pages });
