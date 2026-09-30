import { BrowserWindow, ipcMain } from 'electron';
import { PAGE_CHANNELS } from '../../shared/pages';
import { requireString } from '../ipc';
import { checkAvailability, getProject } from '../projects-store';
import {
  addBlock,
  deleteBlock,
  editBlock,
  getLogStatus,
  getPage,
  getPages,
  getReferences,
  indentBlock,
  locateBlock,
  onPagesChanged,
  outdentBlock,
} from './pages-store/pages-store';
import type { Project } from '../../shared/projects';

/**
 * The log lives in the project's directory, so a write needs both a project we
 * actually track and a directory that is actually there.
 *
 * The reachability check is not politeness: `EventLog.open` creates its parent
 * directories, so writing to an unmounted drive would invent the whole path on
 * the local disk and put the user's notes somewhere the real volume hides the
 * moment it comes back.
 */
async function requireProject(value: unknown): Promise<Project> {
  const id = requireString(value, 'id');
  const project = getProject(id);
  if (!project) throw new Error('No such project');

  const availability = await checkAvailability([id]);
  if (availability[id] !== 'available') {
    throw new Error(`"${project.name}" is not reachable right now.`);
  }
  return project;
}

/**
 * A title is a key in a log that keeps everything forever, so it is checked
 * on arrival: something, and nothing loose around it. Not a date pattern any
 * more — a link can name a page anything — but the link plugin trims what it
 * names, and a title that arrives untrimmed came from somewhere else.
 */
function requireTitle(value: unknown): string {
  const title = requireString(value, 'title');
  if (title === '' || title !== title.trim()) {
    throw new TypeError('Expected a page title');
  }
  return title;
}

export function registerPageIpc(): void {
  /**
   * Every window, not the one that caused it: nothing caused it. A re-fold is
   * reported because a *file* arrived, so there is no originating window to
   * exclude, and any window showing that project is equally behind.
   *
   * A window closing between the fold and the send is ordinary, not an error,
   * which is the only thing the guard is for.
   */
  onPagesChanged((projectId) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(PAGE_CHANNELS.changed, projectId);
      }
    }
  });

  ipcMain.handle(
    PAGE_CHANNELS.open,
    async (_event, id: unknown, title: unknown) =>
      getPage(await requireProject(id), requireTitle(title)),
  );

  ipcMain.handle(PAGE_CHANNELS.openAll, async (_event, id: unknown) =>
    getPages(await requireProject(id)),
  );

  ipcMain.handle(
    PAGE_CHANNELS.references,
    async (_event, id: unknown, title: unknown) =>
      getReferences(await requireProject(id), requireTitle(title)),
  );

  ipcMain.handle(
    PAGE_CHANNELS.locate,
    async (_event, id: unknown, blockId: unknown) =>
      locateBlock(await requireProject(id), requireString(blockId, 'blockId')),
  );

  ipcMain.handle(PAGE_CHANNELS.status, async (_event, id: unknown) =>
    getLogStatus(await requireProject(id)),
  );

  ipcMain.handle(
    PAGE_CHANNELS.addBlock,
    async (
      _event,
      id: unknown,
      title: unknown,
      text: unknown,
      after: unknown,
    ) =>
      addBlock(
        await requireProject(id),
        requireTitle(title),
        requireString(text, 'text'),
        // Absent means the end of the page; anything else has to be a block id
        // before it reaches a log that keeps it forever.
        after === undefined ? undefined : requireString(after, 'after'),
      ),
  );

  // No title on any of these four. The block id is the whole address, so
  // there is nothing to check a title against and nothing to write one into.
  ipcMain.handle(
    PAGE_CHANNELS.editBlock,
    async (_event, id: unknown, blockId: unknown, text: unknown) =>
      editBlock(
        await requireProject(id),
        requireString(blockId, 'blockId'),
        requireString(text, 'text'),
      ),
  );

  ipcMain.handle(
    PAGE_CHANNELS.deleteBlock,
    async (_event, id: unknown, blockId: unknown) =>
      deleteBlock(await requireProject(id), requireString(blockId, 'blockId')),
  );

  ipcMain.handle(
    PAGE_CHANNELS.indentBlock,
    async (_event, id: unknown, blockId: unknown) =>
      indentBlock(await requireProject(id), requireString(blockId, 'blockId')),
  );

  ipcMain.handle(
    PAGE_CHANNELS.outdentBlock,
    async (_event, id: unknown, blockId: unknown) =>
      outdentBlock(await requireProject(id), requireString(blockId, 'blockId')),
  );
}
