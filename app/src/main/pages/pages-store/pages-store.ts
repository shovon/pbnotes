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
 *
 * The plumbing only. What a block *is* — the event schema and the fold over it
 * — is `blocks/blocks.ts`, which knows nothing about logs, devices or windows.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { Projection } from '../../ledger/projection/projection.ts';
import type { DeviceMemory } from '../../ledger/event-log/event-log.ts';
import { find, HANDLES, reduce } from './blocks/blocks.ts';
import type { PageEvent, Pages } from './blocks/blocks.ts';
import { DATE_PATTERN, locate } from '../../../shared/pages.ts';
import type { Block, Page } from '../../../shared/pages.ts';
import { remarkPlugins } from '../../../shared/wikilink/wikilink.ts';
import type { ViewStatus } from '../../../shared/log.ts';

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
 * Told which project's fold moved because something arrived in its folder.
 *
 * Injected for the same reason as `bindDevice`: this file holds no `electron`
 * import, so it cannot reach a window itself and stays runnable under
 * `node --test`. Left unset, another device's notes are folded and nobody is
 * told — which is exactly what a test wants, and what a headless main process
 * would do anyway.
 */
let announce: ((projectId: string) => void) | undefined;

export function onPagesChanged(next: (projectId: string) => void): void {
  announce = next;
}

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
      // And without this the fold would hold them while the window went on
      // showing what it read before them — a refresh nobody can ask for,
      // because there is nothing on screen to say the page is behind.
      //
      // Only a re-fold. This device's own writes already hand the folded page
      // back to the caller that asked for them.
      projection.subscribe((_state, change) => {
        if (change === 'refold') announce?.(project.id);
      });
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

/** The page as it stands right now, empty if nothing has been written to it. */
function pageOf(projection: Projection<Pages>, title: string): Page {
  return { title, blocks: projection.state[title] ?? [] };
}

export async function getPage(
  project: ProjectRef,
  title: string,
): Promise<Page> {
  return pageOf(await projectionFor(project), title);
}

/**
 * The journal: every day that has something on it, newest first, out of the
 * same fold that holds every other page. Only the days — a page a link named
 * shares the fold and the events but is not a day, and stacking it among them
 * would sort `Mira` somewhere between two years.
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
    .filter(([title, blocks]) => DATE_PATTERN.test(title) && blocks.length > 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([title, blocks]) => ({ title, blocks }));
}

/**
 * The pages a text links to and the blocks it refers to, read with the same parser that renders it, so
 * a `#foo` in a code span is text on both sides.
 *
 * Memoised on the text, not the block: identical text links identically,
 * and the fold hands every block an event did not touch back with the text
 * it had — so a write parses the one text that changed, and a refold, which
 * rebuilds every block object from the log every half minute, parses
 * nothing it has seen. Keyed on the object, the whole project would be
 * parsed again after each of those.
 *
 * ponytail: the map keeps every text ever parsed this session, edits
 * included. Strings the log already holds, so it is small; bound it if a
 * long session ever shows it.
 *
 * Read from the `href` the plugin sets, which is the contract the renderer
 * follows a link by; a link to nothing has no `href` and is not a link.
 */
const md = unified().use(remarkParse).use(remarkPlugins);

/** What one parse of a block's text has to say, for everything that asks. */
type Reading = {
  /** The pages it links to. */
  links: string[];
  /** The blocks it refers to, by id. */
  refs: string[];
  /** What a ref to it shows; see `preview`. */
  preview: string;
};

const readings = new Map<string, Reading>();

type Node = {
  type: string;
  data?: { hProperties?: { href?: string; dataBlockRef?: string } };
  position?: { start: { offset: number }; end: { offset: number } };
  children?: Node[];
};

/**
 * What a ref to a block shows: the source of its first paragraph, cut out
 * of the text rather than rebuilt from the tree, so the view renders it with
 * the bold, code and links it was written with. A heading counts — it is a
 * line of prose with a sigil in front, and the cut leaves the sigil behind.
 *
 * Empty for a block that starts with anything else, and the ref shows the id.
 * ponytail: a list or a code block could show its text flattened instead;
 * `mdast-util-to-string` does it, as a dependency of our own, if ids for
 * those turn out to be common.
 *
 * Taken before the plugins run: they replace text nodes with ones that carry
 * no position.
 */
function preview(text: string, root: Node): string {
  const first = root.children?.[0];
  const inline = first?.children ?? [];
  const from = inline[0]?.position?.start.offset;
  const to = inline.at(-1)?.position?.end.offset;
  if (first?.type !== 'paragraph' && first?.type !== 'heading') return '';
  return from === undefined || to === undefined ? '' : text.slice(from, to);
}

function read(text: string): Reading {
  const memo = readings.get(text);
  if (memo) return memo;
  const root = md.parse(text);
  const reading: Reading = {
    links: [],
    refs: [],
    preview: preview(text, root as Node),
  };
  const walk = (node: Node): void => {
    const { href, dataBlockRef } = node.data?.hProperties ?? {};
    if (node.type === 'wikilink' && href) reading.links.push(href.slice(1));
    if (node.type === 'blockRef' && dataBlockRef) {
      reading.refs.push(dataBlockRef);
    }
    node.children?.forEach(walk);
  };
  walk(md.runSync(root) as Node);
  readings.set(text, reading);
  return reading;
}

/**
 * The blocks that link to `title`, each with its subtree intact. A block
 * that links is taken whole and not searched inside: its children are
 * already on show under it, and listing one of them again for a link of its
 * own would put the same words on the page twice.
 */
function linking(blocks: Block[], title: string): Block[] {
  return blocks.flatMap((block) =>
    read(block.text).links.includes(title)
      ? [block]
      : linking(block.children, title),
  );
}

/**
 * What links to a page, grouped by the page it was written on and cut down
 * to the blocks that do the linking. A page is not a reference to itself.
 *
 * Journal days first, newest first, then the named pages A to Z. Days are
 * told apart before anything is compared: a page called `2026` or `1984`
 * would otherwise land among them, and a comparator that turns dates around
 * but leaves everything else forward is not an order at all once a name
 * sorts between two dates.
 *
 * ponytail: one call per page shown, so the journal makes one per day. Fold
 * this into a single reverse index per call if a project ever has enough
 * days for that to show.
 */
export async function getReferences(
  project: ProjectRef,
  title: string,
): Promise<Page[]> {
  const projection = await projectionFor(project);
  return Object.entries(projection.state)
    .filter(([page]) => page !== title)
    .map(([page, blocks]) => ({ title: page, blocks: linking(blocks, title) }))
    .filter((page) => page.blocks.length > 0)
    .sort((a, b) => {
      const days = [a, b].map((page) => DATE_PATTERN.test(page.title));
      if (days[0] !== days[1]) return days[0] ? -1 : 1;
      return days[0]
        ? b.title.localeCompare(a.title)
        : a.title.localeCompare(b.title);
    });
}

/**
 * Every block the project refers to with `((id))`, and what a ref to it
 * shows: the target's first paragraph, or null for an id the project does
 * not have — deleted, or never there.
 *
 * For the whole project rather than per page, and resolved here rather than
 * in the view: a ref points anywhere, the view holds only the pages on
 * screen, and main has all of them. The answer is as big as the number of
 * blocks anyone has referred to, which is small.
 *
 * Pairs, not an object: an id is whatever was typed between the parentheses,
 * and `((__proto__))` is a key an object does not hold.
 */
export async function getPreviews(
  project: ProjectRef,
): Promise<[string, string | null][]> {
  const { state } = await projectionFor(project);
  const ids = new Set<string>();
  const collect = (blocks: Block[]): void => {
    for (const block of blocks) {
      for (const id of read(block.text).refs) ids.add(id);
      collect(block.children);
    }
  };
  Object.values(state).forEach(collect);
  return [...ids].map((id) => {
    const found = find(state, id);
    return [id, found ? read(found.siblings[found.at].text).preview : null];
  });
}

/** The page a block is on, or undefined for a block the project lacks. */
export async function locateBlock(
  project: ProjectRef,
  blockId: string,
): Promise<{ page: string } | undefined> {
  const found = find((await projectionFor(project)).state, blockId);
  return found && { page: found.page };
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
 * Appends one of this fold's events: the payload checked against the schema,
 * and the version taken from `HANDLES` rather than written out here.
 *
 * Both halves of one hazard. A payload literal that drifts from the schema
 * folds to nothing, and a `v` typed out by hand next to a `HANDLES` that says
 * something else is a build whose own gate refuses its own writes — either
 * way the user's keystroke lands on disk and never comes back.
 */
function append<T extends PageEvent['type']>(
  projection: Projection<Pages>,
  type: T,
  payload: Extract<PageEvent, { type: T }>['payload'],
): Promise<unknown> {
  return projection.dispatch(type, payload, HANDLES[type]);
}

/**
 * Writes a new block, at the end of the page or directly beneath `after`.
 *
 * Refuses an `after` that is not on this page, for the same reason `editBlock`
 * refuses an unknown block: the fold would have to guess, and a log that keeps
 * everything forever should not be collecting events that mean nothing.
 */
export async function addBlock(
  project: ProjectRef,
  title: string,
  text: string,
  after?: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const blocks = projection.state[title] ?? [];
  if (after && !locate(blocks, after)) {
    throw new Error('No such block');
  }

  // dispatch appends before it folds, so this resolves only once the event is
  // durable — the page handed back can never show something a crash takes.
  await append(projection, 'block.created', {
    page: title,
    id: randomUUID(),
    text,
    // Left off entirely when absent, so an appended block writes the same
    // bytes it always did.
    ...(after ? { after } : {}),
  });
  return pageOf(projection, title);
}

/**
 * Rewrites a block's text by appending the fact that it changed. Refuses a
 * block the project does not have: the fold would ignore the event, and a log
 * that keeps everything forever should not be collecting events that mean
 * nothing.
 *
 * No page is asked for, and none is written. The block is looked up by id and
 * the page it turned out to be on is what comes back — so a caller showing
 * blocks from several pages at once, which is what a references cut already
 * is, does not have to carry the right title beside each one to be allowed to
 * write.
 */
export async function editBlock(
  project: ProjectRef,
  blockId: string,
  text: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const found = find(projection.state, blockId);
  if (!found) throw new Error('No such block');

  await append(projection, 'block.edited', { id: blockId, text });
  return pageOf(projection, found.page);
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
  blockId: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const found = find(projection.state, blockId);
  if (!found) throw new Error('No such block');

  await append(projection, 'block.deleted', { id: blockId });
  return pageOf(projection, found.page);
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
  blockId: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const found = find(projection.state, blockId);
  if (!found) throw new Error('No such block');
  if (found.at === 0) return pageOf(projection, found.page);

  await append(projection, 'block.indented', {
    id: blockId,
    parent: found.siblings[found.at - 1].id,
  });
  return pageOf(projection, found.page);
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
  blockId: string,
): Promise<Page> {
  const projection = await projectionFor(project);
  const found = find(projection.state, blockId);
  if (!found) throw new Error('No such block');
  if (!found.parent) return pageOf(projection, found.page);

  await append(projection, 'block.outdented', {
    id: blockId,
    after: found.parent.id,
  });
  return pageOf(projection, found.page);
}

export async function closePages(): Promise<void> {
  const open = [...projections.values()];
  projections.clear();
  await Promise.all(open.map(release));
}
