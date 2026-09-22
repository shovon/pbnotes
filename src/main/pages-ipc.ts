import { ipcMain } from 'electron';
import { DATE_PATTERN, PAGE_CHANNELS } from '../shared/pages';
import { requireString } from './projects-ipc';
import { checkAvailability, getProject } from './projects-store';
import { addBlock, deleteBlock, editBlock, getPage } from './pages-store';
import type { Project } from '../shared/projects';

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

function requireDate(value: unknown): string {
  const date = requireString(value, 'date');
  if (!DATE_PATTERN.test(date)) {
    throw new TypeError('Expected date as YYYY-MM-DD');
  }
  return date;
}

export function registerPageIpc(): void {
  ipcMain.handle(
    PAGE_CHANNELS.open,
    async (_event, id: unknown, date: unknown) =>
      getPage(await requireProject(id), requireDate(date)),
  );

  ipcMain.handle(
    PAGE_CHANNELS.addBlock,
    async (
      _event,
      id: unknown,
      date: unknown,
      text: unknown,
      after: unknown,
    ) =>
      addBlock(
        await requireProject(id),
        requireDate(date),
        requireString(text, 'text'),
        // Absent means the end of the page; anything else has to be a block id
        // before it reaches a log that keeps it forever.
        after === undefined ? undefined : requireString(after, 'after'),
      ),
  );

  ipcMain.handle(
    PAGE_CHANNELS.editBlock,
    async (
      _event,
      id: unknown,
      date: unknown,
      blockId: unknown,
      text: unknown,
    ) =>
      editBlock(
        await requireProject(id),
        requireDate(date),
        requireString(blockId, 'blockId'),
        requireString(text, 'text'),
      ),
  );

  ipcMain.handle(
    PAGE_CHANNELS.deleteBlock,
    async (_event, id: unknown, date: unknown, blockId: unknown) =>
      deleteBlock(
        await requireProject(id),
        requireDate(date),
        requireString(blockId, 'blockId'),
      ),
  );
}
