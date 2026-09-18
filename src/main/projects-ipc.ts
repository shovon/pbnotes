import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { PROJECT_CHANNELS } from '../shared/projects';
import type { AddOutcome, PickResult } from '../shared/projects';
import {
  addProjects,
  checkAvailability,
  getProject,
  listProjects,
  relocateProject,
  removeProject,
  renameProject,
  setPinned,
  touchProject,
} from './projects-store';

function parentWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${label} to be a string`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`Expected ${label} to be a string[]`);
  }
  return value as string[];
}

/**
 * Shows a directory picker parented to the calling window so macOS presents it
 * as a sheet rather than a detached dialog.
 */
async function showDirectoryPicker(
  event: IpcMainInvokeEvent,
  options: { multi: boolean; defaultPath?: string; buttonLabel: string },
): Promise<string[]> {
  const properties: Array<'openDirectory' | 'multiSelections' | 'createDirectory'> =
    ['openDirectory', 'createDirectory'];
  if (options.multi) properties.push('multiSelections');

  const parent = parentWindow(event);
  const dialogOptions = {
    properties,
    buttonLabel: options.buttonLabel,
    defaultPath: options.defaultPath,
  };

  const result = parent
    ? await dialog.showOpenDialog(parent, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  return result.canceled ? [] : result.filePaths;
}

export function registerProjectIpc(): void {
  ipcMain.handle(PROJECT_CHANNELS.list, () => listProjects());

  ipcMain.handle(PROJECT_CHANNELS.pick, async (event): Promise<PickResult> => {
    const selected = await showDirectoryPicker(event, {
      multi: true,
      buttonLabel: 'Track Project',
    });
    if (selected.length === 0) return { canceled: true, outcomes: [] };
    return { canceled: false, outcomes: await addProjects(selected) };
  });

  ipcMain.handle(
    PROJECT_CHANNELS.add,
    (_event, paths: unknown): Promise<AddOutcome[]> =>
      addProjects(requireStringArray(paths, 'paths')),
  );

  ipcMain.handle(PROJECT_CHANNELS.remove, (_event, id: unknown) => {
    removeProject(requireString(id, 'id'));
  });

  ipcMain.handle(PROJECT_CHANNELS.rename, (_event, id: unknown, name: unknown) =>
    renameProject(requireString(id, 'id'), requireString(name, 'name')),
  );

  ipcMain.handle(
    PROJECT_CHANNELS.setPinned,
    (_event, id: unknown, pinned: unknown) =>
      setPinned(requireString(id, 'id'), Boolean(pinned)),
  );

  ipcMain.handle(PROJECT_CHANNELS.touch, (_event, id: unknown) =>
    touchProject(requireString(id, 'id')),
  );

  ipcMain.handle(PROJECT_CHANNELS.relocate, async (event, id: unknown) => {
    const projectId = requireString(id, 'id');
    const project = getProject(projectId);
    if (!project) return null;

    const [selected] = await showDirectoryPicker(event, {
      multi: false,
      // Start a level up from where the project used to be; if it moved, its
      // new home is usually nearby.
      defaultPath: path.dirname(project.path),
      buttonLabel: 'Relocate',
    });
    if (!selected) return project;

    return relocateProject(projectId, selected);
  });

  ipcMain.handle(PROJECT_CHANNELS.availability, (_event, ids: unknown) =>
    checkAvailability(requireStringArray(ids, 'ids')),
  );

  ipcMain.handle(PROJECT_CHANNELS.reveal, (_event, id: unknown) => {
    const project = getProject(requireString(id, 'id'));
    if (project) shell.showItemInFolder(project.path);
  });
}
