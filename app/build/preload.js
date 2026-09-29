"use strict";
const electron = require("electron");
const PROJECT_CHANNELS = {
  list: "projects:list",
  pick: "projects:pick",
  add: "projects:add",
  remove: "projects:remove",
  rename: "projects:rename",
  setPinned: "projects:set-pinned",
  touch: "projects:touch",
  relocate: "projects:relocate",
  availability: "projects:availability",
  reveal: "projects:reveal"
};
const PAGE_CHANNELS = {
  open: "pages:open",
  openAll: "pages:open-all",
  references: "pages:references",
  addBlock: "pages:add-block",
  editBlock: "pages:edit-block",
  deleteBlock: "pages:delete-block",
  indentBlock: "pages:indent-block",
  outdentBlock: "pages:outdent-block",
  status: "pages:status",
  changed: "pages:changed"
};
const projects = {
  list: () => electron.ipcRenderer.invoke(PROJECT_CHANNELS.list),
  pick: () => electron.ipcRenderer.invoke(PROJECT_CHANNELS.pick),
  add: (paths) => electron.ipcRenderer.invoke(PROJECT_CHANNELS.add, paths),
  remove: (id) => electron.ipcRenderer.invoke(PROJECT_CHANNELS.remove, id),
  rename: (id, name) => electron.ipcRenderer.invoke(PROJECT_CHANNELS.rename, id, name),
  setPinned: (id, pinned) => electron.ipcRenderer.invoke(PROJECT_CHANNELS.setPinned, id, pinned),
  touch: (id) => electron.ipcRenderer.invoke(PROJECT_CHANNELS.touch, id),
  relocate: (id) => electron.ipcRenderer.invoke(PROJECT_CHANNELS.relocate, id),
  availability: (ids) => electron.ipcRenderer.invoke(PROJECT_CHANNELS.availability, ids),
  reveal: (id) => electron.ipcRenderer.invoke(PROJECT_CHANNELS.reveal, id)
};
const pages = {
  open: (projectId, title) => electron.ipcRenderer.invoke(PAGE_CHANNELS.open, projectId, title),
  openAll: (projectId) => electron.ipcRenderer.invoke(PAGE_CHANNELS.openAll, projectId),
  references: (projectId, title) => electron.ipcRenderer.invoke(PAGE_CHANNELS.references, projectId, title),
  status: (projectId) => electron.ipcRenderer.invoke(PAGE_CHANNELS.status, projectId),
  onChanged: (listener) => {
    const forward = (_event, projectId) => {
      if (typeof projectId === "string") listener(projectId);
    };
    electron.ipcRenderer.on(PAGE_CHANNELS.changed, forward);
    return () => electron.ipcRenderer.off(PAGE_CHANNELS.changed, forward);
  },
  addBlock: (projectId, title, text, after) => electron.ipcRenderer.invoke(PAGE_CHANNELS.addBlock, projectId, title, text, after),
  editBlock: (projectId, blockId, text) => electron.ipcRenderer.invoke(PAGE_CHANNELS.editBlock, projectId, blockId, text),
  deleteBlock: (projectId, blockId) => electron.ipcRenderer.invoke(PAGE_CHANNELS.deleteBlock, projectId, blockId),
  indentBlock: (projectId, blockId) => electron.ipcRenderer.invoke(PAGE_CHANNELS.indentBlock, projectId, blockId),
  outdentBlock: (projectId, blockId) => electron.ipcRenderer.invoke(PAGE_CHANNELS.outdentBlock, projectId, blockId)
};
electron.contextBridge.exposeInMainWorld("gnotes", { projects, pages });
