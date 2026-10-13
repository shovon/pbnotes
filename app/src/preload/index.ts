// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { PROJECT_CHANNELS } from '../shared/projects';
import type { ProjectsApi } from '../shared/projects';
import { IMAGE_SCHEME, PAGE_CHANNELS } from '../shared/pages';
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

/**
 * The wire carries a project id on every call; this is the one place on the
 * renderer's side that puts it there.
 */
const pagesFor = (projectId: string): PagesApi => ({
  open: (title) =>
    ipcRenderer.invoke(PAGE_CHANNELS.open, projectId, title),
  openAll: () => ipcRenderer.invoke(PAGE_CHANNELS.openAll, projectId),
  references: (title) =>
    ipcRenderer.invoke(PAGE_CHANNELS.references, projectId, title),
  locate: (blockId) =>
    ipcRenderer.invoke(PAGE_CHANNELS.locate, projectId, blockId),
  previews: () =>
    ipcRenderer.invoke(PAGE_CHANNELS.previews, projectId),
  status: () => ipcRenderer.invoke(PAGE_CHANNELS.status, projectId),
  onChanged: (listener) => {
    // Wrapped rather than handed to `ipcRenderer.on` directly: the first
    // argument of an IPC event is the event itself, which carries `sender`,
    // and the whole point of the bridge is that the renderer never gets that.
    const forward = (_event: IpcRendererEvent, id: unknown): void => {
      if (id === projectId) listener();
    };
    ipcRenderer.on(PAGE_CHANNELS.changed, forward);
    return () => ipcRenderer.off(PAGE_CHANNELS.changed, forward);
  },
  addBlock: (title, text, after) =>
    ipcRenderer.invoke(PAGE_CHANNELS.addBlock, projectId, title, text, after),
  addImage: (bytes, mime) =>
    ipcRenderer.invoke(PAGE_CHANNELS.addImage, projectId, bytes, mime),
  imageSrc: (name) => `${IMAGE_SCHEME}://${projectId}/${name}`,
  editBlock: (blockId, text) =>
    ipcRenderer.invoke(PAGE_CHANNELS.editBlock, projectId, blockId, text),
  deleteBlock: (blockId) =>
    ipcRenderer.invoke(PAGE_CHANNELS.deleteBlock, projectId, blockId),
  indentBlock: (blockId) =>
    ipcRenderer.invoke(PAGE_CHANNELS.indentBlock, projectId, blockId),
  outdentBlock: (blockId) =>
    ipcRenderer.invoke(PAGE_CHANNELS.outdentBlock, projectId, blockId),
  blockMenu: (blockId) => ipcRenderer.invoke(PAGE_CHANNELS.blockMenu, blockId),
});

// Only this explicit surface crosses the context bridge; the renderer never
// sees `ipcRenderer` itself.
contextBridge.exposeInMainWorld('pbnotes', { projects, pagesFor });
