import { BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { readPoint, requireString, requireStringArray } from '../../ipc';
import { PROJECT_CHANNELS } from '../../../shared/projects';
import type { AddOutcome, PickerMenuPick, PickResult } from '../../../shared/projects';
import { pickerRows } from './picker-menu/picker-menu';
import type { PickerOptions, PickerRow } from './picker-menu/picker-menu';
import type { ProjectsStore } from './projects-store';
import type { OpenProject } from './open-project/open-project';

function parentWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
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

/** One of the picker menu's rows as a native menu item, resolving with its pick. */
function pickerItem(
  row: PickerRow,
  resolve: (pick: PickerMenuPick) => void,
): MenuItemConstructorOptions {
  switch (row.kind) {
    case 'project':
      return {
        type: 'radio',
        label: row.label,
        sublabel: row.sublabel,
        checked: row.checked,
        click: () => resolve({ kind: 'open', id: row.id }),
      };
    case 'separator':
      return { type: 'separator' };
    case 'add':
      return { label: row.label, click: () => resolve({ kind: 'add' }) };
  }
}

/**
 * The `projects:*` channels: arguments checked as they arrive, then handed to
 * the registry, or to which project is open (`open-project.ts`) for the three
 * calls that can change that. What only Electron can do — the directory picker,
 * showing a folder and the picker's menu — is here too.
 *
 * `picker` is what the picker's menu (#373) needs of the machine: where home
 * is, and whether the platform draws a sublabel.
 */
export function registerProjectIpc(
  store: ProjectsStore,
  openProject: Pick<OpenProject, 'currentProject' | 'open' | 'remove'>,
  picker: PickerOptions,
): void {
  ipcMain.handle(PROJECT_CHANNELS.list, () => store.listProjects());

  ipcMain.handle(PROJECT_CHANNELS.pick, async (event): Promise<PickResult> => {
    const selected = await showDirectoryPicker(event, {
      multi: true,
      buttonLabel: 'Track Project',
    });
    if (selected.length === 0) return { canceled: true, outcomes: [] };
    return { canceled: false, outcomes: await store.addProjects(selected) };
  });

  ipcMain.handle(
    PROJECT_CHANNELS.add,
    (_event, paths: unknown): Promise<AddOutcome[]> =>
      store.addProjects(requireStringArray(paths, 'paths')),
  );

  ipcMain.handle(PROJECT_CHANNELS.remove, (_event, id: unknown) => {
    openProject.remove(requireString(id, 'id'));
  });

  ipcMain.handle(PROJECT_CHANNELS.rename, (_event, id: unknown, name: unknown) =>
    store.renameProject(requireString(id, 'id'), requireString(name, 'name')),
  );

  ipcMain.handle(
    PROJECT_CHANNELS.setPinned,
    (_event, id: unknown, pinned: unknown) =>
      store.setPinned(requireString(id, 'id'), Boolean(pinned)),
  );

  ipcMain.handle(PROJECT_CHANNELS.open, (_event, id: unknown) => {
    openProject.open(requireString(id, 'id'));
  });

  ipcMain.handle(PROJECT_CHANNELS.current, () => openProject.currentProject());

  ipcMain.handle(PROJECT_CHANNELS.relocate, async (event, id: unknown) => {
    const projectId = requireString(id, 'id');
    const project = store.getProject(projectId);
    if (!project) return null;

    const [selected] = await showDirectoryPicker(event, {
      multi: false,
      // Start a level up from where the project used to be; if it moved, its
      // new home is usually nearby.
      defaultPath: path.dirname(project.path),
      buttonLabel: 'Relocate',
    });
    if (!selected) return project;

    return store.relocateProject(projectId, selected);
  });

  ipcMain.handle(PROJECT_CHANNELS.availability, (_event, ids: unknown) =>
    store.checkAvailability(requireStringArray(ids, 'ids')),
  );

  ipcMain.handle(PROJECT_CHANNELS.reveal, (_event, id: unknown) => {
    const project = store.getProject(requireString(id, 'id'));
    if (project) shell.showItemInFolder(project.path);
  });

  // Settles the way the Recent menu's does (`sidebar-ipc.ts`): on the first
  // of a `click` and the menu closing, with the close a moment late, since
  // which of the two the platform reports first is not promised.
  ipcMain.handle(PROJECT_CHANNELS.pickerMenu, (event, at: unknown, openId: unknown) => {
    const point = readPoint(at);
    const open = typeof openId === 'string' ? openId : null;
    const window = parentWindow(event) ?? undefined;
    return new Promise<PickerMenuPick | null>((resolve) => {
      const rows = pickerRows(store.listProjects(), open, picker);
      Menu.buildFromTemplate(rows.map((row) => pickerItem(row, resolve))).popup({
        window,
        ...point,
        callback: () => setTimeout(() => resolve(null), 100),
      });
    });
  });
}
