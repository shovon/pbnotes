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
import type { DeviceMemory } from './event-log.ts';
import { locate } from '../shared/pages.ts';
import type { Block, Page } from '../shared/pages.ts';
import type { ViewStatus } from '../shared/log.ts';

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
 * Event type → the highest payload `v` this build can fold.
 *
 * Kept beside `reduce` because it has to change whenever `reduce` does. Its
 * job is the case a single-writer log could never produce: a newer build on
 * another machine writing something this one does not understand. Those events
 * are skipped, as they always were, but now they are counted and reported
 * rather than silently leaving holes in the page.
 */
export const HANDLES: Record<string, number> = {
  'block.created': 1,
  'block.edited': 1,
  'block.deleted': 1,
  'block.indented': 1,
  'block.outdented': 1,
};

/**
 * How this machine identifies itself in a shared folder, and where it keeps
 * what it remembers between sessions.
 *
 * Injected rather than imported so the store stays runnable under
 * `node --test`, which has no `userData` and no database. Left unset, every
 * session writes in a directory of its own: visible litter, never a lost
 * event, and exactly what a test wants.
 */
export type DeviceBinding = {
  device: string;
  recall(projectId: string): DeviceMemory;
  remember(projectId: string, memory: DeviceMemory): void;
  rotate(): string;
};

let binding: DeviceBinding | undefined;

export function bindDevice(next: DeviceBinding): void {
  binding = next;
}

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
 * upcast. Nesting needed no upcast either: `children` is a fact about the
 * fold, not about the events, and a log written before blocks could nest
 * folds to a tree of leaves.
 */

/**
 * `block` spliced in directly after `after`, wherever in the tree that is.
 * Undefined when `after` is not in this subtree, so the caller can tell
 * "not here, keep looking" from "here, and this is the result".
 *
 * A sibling of `after`, which is what makes `after` alone enough to place a
 * block at any depth: Enter inside a nested block writes the next one beside
 * it, not back at the top level.
 */
function beside(
  blocks: Block[],
  after: string,
  block: Block,
): Block[] | undefined {
  const at = blocks.findIndex((it) => it.id === after);
  if (at !== -1) {
    const next = [...blocks];
    next.splice(at + 1, 0, block);
    return next;
  }
  for (let i = 0; i < blocks.length; i++) {
    const children = beside(blocks[i].children, after, block);
    if (!children) continue;
    const next = [...blocks];
    next[i] = { ...blocks[i], children };
    return next;
  }
  return undefined;
}

/** The block and everything under it, gone from wherever it sat. */
function without(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) => ({ ...block, children: without(block.children, id) }));
}

/** `parent`'s children put through `next`, wherever `parent` is. */
function mapChildren(
  blocks: Block[],
  parent: string,
  next: (children: Block[]) => Block[],
): Block[] {
  return blocks.map((it) =>
    it.id === parent
      ? { ...it, children: next(it.children) }
      : { ...it, children: mapChildren(it.children, parent, next) },
  );
}

export const reduce: Reducer<Pages> = (state, event) => {
  const { page, id, text, after, parent } = event.payload as {
    page: string;
    id: string;
    text: string;
    after?: string;
    parent?: string;
  };

  if (event.type === 'block.created') {
    const blocks = state[page] ?? [];
    const block: Block = { id, text, children: [] };
    // `addBlock` refuses an `after` the page does not have, so missing it here
    // means a log written by something else. Append rather than drop: a block
    // in the wrong place can be moved, one the fold discarded is just gone.
    const next = (after && beside(blocks, after, block)) || [...blocks, block];
    return { ...state, [page]: next };
  }

  if (event.type === 'block.edited') {
    const blocks = state[page];
    if (!blocks) return state;
    const edit = (it: Block[]): Block[] =>
      it.map((block) =>
        block.id === id
          ? { ...block, text }
          : { ...block, children: edit(block.children) },
      );
    return { ...state, [page]: edit(blocks) };
  }

  if (event.type === 'block.deleted') {
    const blocks = state[page];
    if (!blocks) return state;
    // A plain filter, no tombstone. Nothing later in the log needs to know
    // this block was here: `after` only ever names a block that was present
    // when it was written, and a stray edit arriving afterwards already folds
    // to nothing through the `edit` above.
    //
    // The subtree goes with it. The events that built those children are all
    // still on disk — what the fold stops showing is a block the user said
    // they were done with, and everything they had filed underneath it.
    return { ...state, [page]: without(blocks, id) };
  }

  if (event.type === 'block.indented') {
    const blocks = state[page];
    if (!blocks || !parent) return state;
    const found = locate(blocks, id);
    const moving = found?.siblings[found.at];
    // Detach before attaching, and read `moving` before either: it carries
    // its own children across, so the block that lands under `parent` is the
    // whole subtree, not a stripped copy of its root.
    if (!moving || !locate(blocks, parent)) return state;
    return {
      ...state,
      [page]: mapChildren(without(blocks, id), parent, (children) => [
        ...children,
        moving,
      ]),
    };
  }

  if (event.type === 'block.outdented') {
    const blocks = state[page];
    if (!blocks || !after) return state;
    const found = locate(blocks, id);
    if (!found?.parent) return state;

    // The siblings below it come along as its own children. Leaving them
    // behind would strand them inside the old parent, which renders *above*
    // where this block is going — so the page would come back reading in a
    // different order than the user left it, off one keystroke that only
    // asked about depth.
    const moving = found.siblings[found.at];
    const trailing = found.siblings.slice(found.at + 1);
    const outdented = {
      ...moving,
      children: [...moving.children, ...trailing],
    };
    const trimmed = mapChildren(blocks, found.parent.id, (children) =>
      children.slice(0, found.at),
    );
    // `after` is the block it used to hang under, so this lands it directly
    // beneath, at that block's own level.
    return {
      ...state,
      [page]: beside(trimmed, after, outdented) ?? [...trimmed, outdented],
    };
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
    projection: Projection.open<Pages>(logDirectory(project.path), reduce, {}, {
      handles: HANDLES,
      device: binding?.device,
      memory: binding?.recall(project.id),
      remember: (memory) => binding?.remember(project.id, memory),
      // A new identity is this machine's, not this project's: every project's
      // log has to start writing under it from here on.
      rotate: () => {
        if (!binding) throw new Error('No device binding to rotate');
        const device = binding.rotate();
        binding = { ...binding, device };
        return device;
      },
    }).then((projection) => {
      // The folder is shared, so another machine's notes can land at any
      // moment. Without this they would not appear until the app restarts.
      projection.watch();
      return projection;
    }),
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
 * Every day that has something on it, newest first: the whole project out of
 * one fold, which is what the default view stacks.
 *
 * A day that folds to nothing is left out. A date whose only block was
 * deleted is not a page the user wrote on any more, and a heading with
 * nothing under it reads like something went missing.
 *
 * Today is not added here. Which day that is depends on the user's timezone,
 * and main holds no opinion about that — the renderer puts today at the top
 * of the stack whether or not it is in this list.
 *
 * Sorted on the date string, which for `YYYY-MM-DD` is the same order as the
 * dates themselves. That is the reason for the format.
 */
export async function getPages(project: ProjectRef): Promise<Page[]> {
  const projection = await projectionFor(project);
  return Object.entries(projection.state)
    .filter(([, blocks]) => blocks.length > 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, blocks]) => ({ date, blocks }));
}

/**
 * How much of the folder this project's log could be read, and what the fold
 * could not use. Nothing here is an error to clear — a device that is still
 * syncing is a normal state that usually heals itself — but none of it may be
 * skipped without the user being able to find out.
 */
export async function getLogStatus(project: ProjectRef): Promise<ViewStatus> {
  return (await projectionFor(project)).status;
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
  if (after && !locate(blocks, after)) {
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
  if (!locate(blocks, blockId)) {
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
  if (!locate(blocks, blockId)) {
    throw new Error('No such block');
  }

  await projection.dispatch('block.deleted', { page: date, id: blockId });
  return { date, blocks: projection.state[date] ?? [] };
}

/**
 * Moves a block under the sibling above it, children and all.
 *
 * The event records the parent it resolved to, not just "the user pressed
 * Tab". Both would replay identically — the fold is deterministic, so the
 * sibling above is the same one on replay as it was live — but the resolved
 * form is the one that still reads correctly if what Tab *means* ever
 * changes, and it is what `after` already does for a new block.
 *
 * A block that is first among its siblings has nothing above it to move
 * under. Nothing is appended and the page comes back as it was: the outline
 * did not change, and a log that keeps everything forever has no use for the
 * record of a keystroke that did nothing.
 */
export async function indentBlock(
  project: ProjectRef,
  date: string,
  blockId: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const blocks = projection.state[date] ?? [];
  const found = locate(blocks, blockId);
  if (!found) throw new Error('No such block');
  if (found.at === 0) return { date, blocks };

  await projection.dispatch('block.indented', {
    page: date,
    id: blockId,
    parent: found.siblings[found.at - 1].id,
  });
  return { date, blocks: projection.state[date] ?? [] };
}

/**
 * Brings a block out a level, to sit directly beneath what it used to hang
 * under, taking the siblings that were below it along as its children.
 *
 * The event names the block it lands beneath rather than the level it landed
 * at, which is the same thing `after` means everywhere else in this log.
 *
 * A block already at the top level has nothing to come out of. Nothing is
 * appended and the page comes back as it was, like an indent with no sibling
 * above it.
 */
export async function outdentBlock(
  project: ProjectRef,
  date: string,
  blockId: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const blocks = projection.state[date] ?? [];
  const found = locate(blocks, blockId);
  if (!found) throw new Error('No such block');
  if (!found.parent) return { date, blocks };

  await projection.dispatch('block.outdented', {
    page: date,
    id: blockId,
    after: found.parent.id,
  });
  return { date, blocks: projection.state[date] ?? [] };
}

export async function closePages(): Promise<void> {
  const open = [...projections.values()];
  projections.clear();
  await Promise.all(open.map(release));
}
