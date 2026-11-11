// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { PROJECT_CHANNELS } from '../shared/projects';
import type { ProjectsApi } from '../shared/projects';
import { GRAPH_CHANNELS } from '../shared/graph';
import type { GraphApi } from '../shared/graph';
import { BENCH_CHANNELS } from '../shared/bench';
import type { BenchApi } from '../shared/bench';
import { WINDOW_CHANNELS } from '../shared/window';
import type { TabItem, WindowApi } from '../shared/window';
import { SIDEBAR_CHANNELS } from '../shared/sidebar';
import type { SidebarApi } from '../shared/sidebar';

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

const graph: GraphApi = {
  view: (place, today, through) => ipcRenderer.invoke(GRAPH_CHANNELS.view, place, today, through),
  // Hands each version on without the event: the first argument of an IPC
  // event carries `sender`, and the whole point of the bridge is that the
  // renderer never gets that.
  onChanged: (listener) => {
    const heard = (_event: IpcRendererEvent, version: number) =>
      listener(version);
    ipcRenderer.on(GRAPH_CHANNELS.changed, heard);
    return () => {
      ipcRenderer.off(GRAPH_CHANNELS.changed, heard);
    };
  },
  // The way alone, as `onChanged` hands on the version alone.
  onTake: (listener) => {
    const heard = (_event: IpcRendererEvent, way: 'undo' | 'redo') => listener(way);
    ipcRenderer.on(GRAPH_CHANNELS.take, heard);
    return () => {
      ipcRenderer.off(GRAPH_CHANNELS.take, heard);
    };
  },
  locate: (blockId) => ipcRenderer.invoke(GRAPH_CHANNELS.locate, blockId),
  renamed: (names) => ipcRenderer.invoke(GRAPH_CHANNELS.renamed, names),
  icons: (titles) => ipcRenderer.invoke(GRAPH_CHANNELS.icons, titles),
  search: (query) => ipcRenderer.invoke(GRAPH_CHANNELS.search, query),
  find: (query) => ipcRenderer.invoke(GRAPH_CHANNELS.find, query),
  pages: () => ipcRenderer.invoke(GRAPH_CHANNELS.pages),
  status: () => ipcRenderer.invoke(GRAPH_CHANNELS.status),
  run: (command) => ipcRenderer.invoke(GRAPH_CHANNELS.command, command),
  addImage: (bytes, mime) =>
    ipcRenderer.invoke(GRAPH_CHANNELS.addImage, bytes, mime),
  image: (name) => ipcRenderer.invoke(GRAPH_CHANNELS.image, name),
  imageSource: () => ipcRenderer.invoke(GRAPH_CHANNELS.imageSource),
  carryImages: (images, source) =>
    ipcRenderer.invoke(GRAPH_CHANNELS.carryImages, images, source),
  copy: (clip) => ipcRenderer.invoke(GRAPH_CHANNELS.copy, clip),
  blockMenu: (blockId, offer) =>
    ipcRenderer.invoke(GRAPH_CHANNELS.blockMenu, blockId, offer),
  pageMenu: (at, offer) => ipcRenderer.invoke(GRAPH_CHANNELS.pageMenu, at, offer),
};

const bench: BenchApi = {
  get: (slot) => ipcRenderer.invoke(BENCH_CHANNELS.get, slot),
  set: (slot, value) => ipcRenderer.invoke(BENCH_CHANNELS.set, slot, value),
};

const sidebar: SidebarApi = {
  recentMenu: (at) => ipcRenderer.invoke(SIDEBAR_CHANNELS.recentMenu, at),
};

const window: WindowApi = {
  close: () => ipcRenderer.invoke(WINDOW_CHANNELS.close),
  // The item alone, as `graph.onTake` hands on the way alone.
  onTab: (listener) => {
    const heard = (_event: IpcRendererEvent, item: TabItem) => listener(item);
    ipcRenderer.on(WINDOW_CHANNELS.tab, heard);
    return () => {
      ipcRenderer.off(WINDOW_CHANNELS.tab, heard);
    };
  },
  menu: (at) => ipcRenderer.invoke(WINDOW_CHANNELS.menu, at),
};

// Only this explicit surface crosses the context bridge; the renderer never
// sees `ipcRenderer` itself.
contextBridge.exposeInMainWorld('pbnotes', { projects, graph, bench, sidebar, window });
