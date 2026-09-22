/**
 * Project content: one pages projection per project, folded out of a log that
 * lives *inside the project's own directory*.
 *
 * That location is the point of the whole app. A project folder is where the
 * user's work already lives, so the notes about it belong beside it: they get
 * backed up with it, sync with it, travel with it to another machine, and
 * outlive gnotes itself. Put them in `userData` instead and wiping an OS
 * support folder — or losing the registry that maps a UUID back to a path —
 * takes the writing with it. The content is the user's, not the app's.
 *
 * Deliberately free of `electron` imports, like `projection.ts`: callers hand
 * in the project, which also keeps the store runnable under `node --test`.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Projection } from './projection.ts';
import type { Reducer } from './projection.ts';
import type { Block, Page } from '../shared/pages.ts';

/** Enough of a project to find its log. */
export type ProjectRef = {
  id: string;
  path: string;
};

/**
 * `<project>/gnotes/`, holding the numbered segments. Visible, not behind a
 * dot: a dot-directory tells the user "you can safely ignore this", which is
 * true of a tool's bookkeeping and a lie about the only copy of their notes.
 *
 * A folder rather than a loose file because the log is segmented and there
 * will be more than one of them, and because the things that come later —
 * images and whatever else a page can hold — get their own folders beside it.
 */
export function logDirectory(projectPath: string): string {
  return path.join(projectPath, 'gnotes');
}

/** Date → the blocks written on it. */
type Pages = Record<string, Block[]>;

/**
 * Pure, and over state that survives a structured clone: the view crosses to
 * the renderer as data and the fold may one day run off-thread.
 *
 * All three event types are v1 so far. A payload shape that changes gets a new `v`
 * and is upcast by branching here; the file on disk is never rewritten — an
 * edit is a second fact appended after the first, not a correction of it.
 *
 * `page` rides along in the payload so a block can be found without scanning
 * every day the user ever wrote on.
 *
 * A block's position is where the fold puts it, and nowhere else: blocks carry
 * no index, because an index stored on a record has to be rewritten on every
 * neighbour the moment anything lands between them. `after` says which block
 * the new one was written beneath, which is a fact about what the user did and
 * so stays true forever; the array it produces is derived, and derived the
 * same way on replay as it was live.
 *
 * Still v1. `after` is optional and its absence has always meant what it means
 * now — at the end — so every event already on disk reads correctly with no
 * upcast.
 */
export const reduce: Reducer<Pages> = (state, event) => {
  const { page, id, text, after } = event.payload as {
    page: string;
    id: string;
    text: string;
    after?: string;
  };

  if (event.type === 'block.created') {
    const blocks = state[page] ?? [];
    // `addBlock` refuses an `after` the page does not have, so missing it here
    // means a log written by something else. Append rather than drop: a block
    // in the wrong place can be moved, one the fold discarded is just gone.
    const at = after ? blocks.findIndex((block) => block.id === after) : -1;
    const next = [...blocks];
    next.splice(at === -1 ? blocks.length : at + 1, 0, { id, text });
    return { ...state, [page]: next };
  }

  if (event.type === 'block.edited') {
    const blocks = state[page];
    if (!blocks) return state;
    return {
      ...state,
      [page]: blocks.map((block) =>
        block.id === id ? { ...block, text } : block,
      ),
    };
  }

  if (event.type === 'block.deleted') {
    const blocks = state[page];
    if (!blocks) return state;
    // A plain filter, no tombstone. Nothing later in the log needs to know
    // this block was here: `after` only ever names a block that was present
    // when it was written, and a stray edit arriving afterwards already folds
    // to nothing through the `map` above.
    return { ...state, [page]: blocks.filter((block) => block.id !== id) };
  }

  return state;
};

/**
 * Cached by project id, but remembering the path it was opened at, and
 * holding the *promise* rather than the projection — two overlapping opens of
 * one project would otherwise each end up with their own appender on one file,
 * and two appenders means two writers picking the same sequence numbers.
 */
type Entry = {
  path: string;
  projection: Promise<Projection<Pages>>;
};

const projections = new Map<string, Entry>();

async function release(entry: Entry): Promise<void> {
  try {
    await (await entry.projection).close();
  } catch {
    // A log that never opened has nothing to close.
  }
}

function projectionFor(project: ProjectRef): Promise<Projection<Pages>> {
  const cached = projections.get(project.id);
  if (cached?.path === project.path) return cached.projection;
  // Relocated since it was last opened. The log travelled with the directory,
  // so the open handle points at a file that is no longer this project's.
  if (cached) void release(cached);

  const entry: Entry = {
    path: project.path,
    projection: Projection.open<Pages>(
      logDirectory(project.path),
      reduce,
      {},
    ),
  };
  // A log that failed to open — a damaged tail, a directory that went away
  // mid-write — must not stay cached as this project's log for the session.
  entry.projection.catch(() => {
    if (projections.get(project.id) === entry) projections.delete(project.id);
  });
  projections.set(project.id, entry);
  return entry.projection;
}

export async function getPage(
  project: ProjectRef,
  date: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  return { date, blocks: projection.state[date] ?? [] };
}

/**
 * Writes a new block, at the end of the day or directly beneath `after`.
 *
 * Refuses an `after` that is not on this page, for the same reason `editBlock`
 * refuses an unknown block: the fold would have to guess, and a log that keeps
 * everything forever should not be collecting events that mean nothing.
 */
export async function addBlock(
  project: ProjectRef,
  date: string,
  text: string,
  after?: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const blocks = projection.state[date] ?? [];
  if (after && !blocks.some((block) => block.id === after)) {
    throw new Error('No such block');
  }

  // dispatch appends before it folds, so this resolves only once the event is
  // durable — the page handed back can never show something a crash takes.
  await projection.dispatch('block.created', {
    page: date,
    id: randomUUID(),
    text,
    // Left off entirely when absent, so an appended block writes the same
    // bytes it always did.
    ...(after ? { after } : {}),
  });
  return { date, blocks: projection.state[date] ?? [] };
}

/**
 * Rewrites a block's text by appending the fact that it changed. Refuses a
 * block the page does not have: the fold would ignore the event, and a log
 * that keeps everything forever should not be collecting events that mean
 * nothing.
 */
export async function editBlock(
  project: ProjectRef,
  date: string,
  blockId: string,
  text: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const blocks = projection.state[date] ?? [];
  if (!blocks.some((block) => block.id === blockId)) {
    throw new Error('No such block');
  }

  await projection.dispatch('block.edited', {
    page: date,
    id: blockId,
    text,
  });
  return { date, blocks: projection.state[date] ?? [] };
}

/**
 * Removes a block by appending the fact that the user deleted it. Refuses one
 * the page does not have, like `editBlock`.
 *
 * Nothing is taken off disk. Every word the block ever held is still in the
 * log, in the events that put it there — what the fold stops showing is a
 * block the user said they were done with, which is a different claim from
 * "this was never written".
 */
export async function deleteBlock(
  project: ProjectRef,
  date: string,
  blockId: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const blocks = projection.state[date] ?? [];
  if (!blocks.some((block) => block.id === blockId)) {
    throw new Error('No such block');
  }

  await projection.dispatch('block.deleted', { page: date, id: blockId });
  return { date, blocks: projection.state[date] ?? [] };
}

export async function closePages(): Promise<void> {
  const open = [...projections.values()];
  projections.clear();
  await Promise.all(open.map(release));
}
