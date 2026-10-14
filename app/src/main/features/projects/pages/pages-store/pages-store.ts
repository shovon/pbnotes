/**
 * Pages: what page events mean, read and written through whichever view of
 * the pages fold a caller hands in. Nothing here knows what that is a view
 * of: not a ledger, not its id, not where it is kept.
 *
 * No plumbing, and no import of any. Where the log lives, which device this
 * is and which logs are open belong to `ledger/project-ledger`; what a block
 * *is* — the event schema and the fold over it — is `shared/blocks/blocks.ts`.
 * What is left here is the fold as it is handed to whoever registers it, the
 * commands that author events and the queries over what they fold to.
 *
 * What several machines writing at once does to a page, and what the block
 * fold still gets wrong then, is `docs/block-sync.md`.
 *
 * Deliberately free of `electron` imports: callers hand in the view, which
 * keeps the store runnable under `node --test`.
 */
import { randomUUID } from "node:crypto";
import {
  find,
  HANDLES,
  indented,
  NAMESPACE,
  outdented,
  reduce,
} from "../../../../../shared/blocks/blocks.ts";
import { linking, read } from "../reading.ts";
import type {
  PageEvent,
  Pages,
} from "../../../../../shared/blocks/blocks.ts";
import { DATE_PATTERN, locate } from "../../../../../shared/pages.ts";
import type {
  Block,
  Page,
  PagesState,
  Place,
} from "../../../../../shared/pages.ts";
import type { ViewStatus } from "../../../../../shared/log.ts";

/**
 * The pages fold, for whoever wires the app together to register with the
 * ledger. Not registered here: that would take a ledger to register it with.
 */
export const pagesFold: {
  reduce: typeof reduce;
  initial: Pages;
  handles: typeof HANDLES;
} = { reduce, initial: {}, handles: HANDLES };

/**
 * What the store is handed: the pages as they stand, how much of the log
 * could be read, and the way to append one of this fold's events. The shape
 * of what registering `pagesFold` gives back, written out so that nothing
 * here imports it.
 */
export type PagesView = {
  readonly state: Pages;
  readonly status: ViewStatus;
  /** Resolves once the event is durable and folded. */
  dispatch(type: PageEvent["type"], payload: unknown): Promise<unknown>;
};

/** The page as it stands right now, empty if nothing has been written to it. */
function pageOf(view: PagesView, title: string): Page {
  return { title, blocks: view.state[title] ?? [] };
}

export function getPage(view: PagesView, title: string): Page {
  return pageOf(view, title);
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
 * Today is not added here. Which day that is depends on the clock, and this
 * is a reading of the log — `getState` is handed today and puts it at the top
 * whether or not it is in this list.
 *
 * Sorted on the date string, which for `YYYY-MM-DD` is the same order as the
 * dates themselves. That is the reason for the format.
 */
export function getPages(view: PagesView): Page[] {
  return Object.entries(view.state)
    .filter(([title, blocks]) => DATE_PATTERN.test(title) && blocks.length > 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([title, blocks]) => ({ title, blocks }));
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
 * this into a single reverse index per call if a ledger ever has enough
 * days for that to show.
 */
export function getReferences(view: PagesView, title: string): Page[] {
  return Object.entries(view.state)
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
 * Every block the pages refer to with `((id))`, and what a ref to it
 * shows: the target's first paragraph, or null for an id the ledger does
 * not have — deleted, or never there.
 *
 * For the whole ledger rather than per page, and resolved here rather than
 * in the view: a ref points anywhere, the view holds only the pages on
 * screen, and main has all of them. The answer is as big as the number of
 * blocks anyone has referred to, which is small.
 *
 * Pairs, not an object: an id is whatever was typed between the parentheses,
 * and `((__proto__))` is a key an object does not hold.
 */
export function getPreviews({ state }: PagesView): [string, string | null][] {
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

/**
 * Everything that shows at the end of `trail`: the one page it ends on, or
 * the journal, each with what links to it, and what every ref quotes.
 *
 * Today is in the journal whether or not it has been written on: it is the
 * day the user is about to type in. Handed in, because which day that is
 * belongs to the clock and not to the log. Sorted again only when it is
 * added, and only because a day dated later than today can exist — another
 * machine with a fast clock, or a folder that travelled backwards across a
 * date line.
 *
 * An empty today is asked what links to it too: other days can name it. Not
 * under a zoom, where what links to the page is not about the block showing.
 *
 * ponytail: the whole history, on every change. Send only the days in view
 * when someone has enough years in one ledger for that to show.
 */
export function getState(
  view: PagesView,
  trail: Place[],
  today: string,
): PagesState {
  const at = trail.at(-1);
  let pages: Page[];
  if (at) {
    pages = [getPage(view, at.page)];
  } else {
    pages = getPages(view);
    if (!pages.some((page) => page.title === today)) {
      pages = [{ title: today, blocks: [] }, ...pages].sort((a, b) =>
        b.title.localeCompare(a.title),
      );
    }
  }
  return {
    trail,
    showing: pages.map((page) => ({
      page,
      references: at?.block ? [] : getReferences(view, page.title),
    })),
    previews: getPreviews(view),
  };
}

/** The page a block is on, or undefined for a block the ledger lacks. */
export function locateBlock(
  view: PagesView,
  blockId: string,
): { page: string } | undefined {
  const found = find(view.state, blockId);
  return found && { page: found.page };
}

/**
 * How much of the folder this ledger is kept in could be read, and what the fold
 * could not use. Nothing here is an error to clear — a device that is still
 * syncing is a normal state that usually heals itself — but none of it may be
 * skipped without the user being able to find out.
 */
export function getLogStatus(view: PagesView): ViewStatus {
  return view.status;
}

/**
 * Appends one of this fold's events: the payload checked against the schema,
 * and the version left to the view, which takes it from `HANDLES`.
 *
 * Both halves of one hazard. A payload literal that drifts from the schema
 * folds to nothing, and a `v` typed out by hand next to a `HANDLES` that says
 * something else is a build whose own gate refuses its own writes — either
 * way the user's keystroke lands on disk and never comes back.
 */
function append<T extends PageEvent["type"]>(
  view: PagesView,
  type: T,
  payload: Extract<PageEvent, { type: T }>["payload"],
): Promise<unknown> {
  return view.dispatch(type, payload);
}

/**
 * Writes a new block, at the end of the page or directly beneath `after`.
 *
 * Refuses an `after` that is not on this page, for the same reason `editBlock`
 * refuses an unknown block: the fold would have to guess, and a log that keeps
 * everything forever should not be collecting events that mean nothing.
 *
 * The id is the caller's when it has one: the renderer draws a block before
 * it is written, and the block on disk has to be the one on screen. One the
 * ledger already has is refused — two blocks answering to one id is a page
 * that every later event about either of them folds wrongly.
 */
export async function addBlock(
  view: PagesView,
  title: string,
  text: string,
  after?: string,
  id: string = randomUUID(),
): Promise<Page> {
  const blocks = view.state[title] ?? [];
  if (after && !locate(blocks, after)) {
    throw new Error("No such block");
  }
  if (find(view.state, id)) throw new Error("That block already exists");

  // dispatch appends before it folds, so this resolves only once the event is
  // durable — the page handed back can never show something a crash takes.
  await append(view, `${NAMESPACE}block.created`, {
    page: title,
    id,
    text,
    // Left off entirely when absent, so an appended block writes the same
    // bytes it always did.
    ...(after ? { after } : {}),
  });
  return pageOf(view, title);
}

/**
 * Rewrites a block's text by appending the fact that it changed. Refuses a
 * block the ledger does not have: the fold would ignore the event, and a log
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
  view: PagesView,
  blockId: string,
  text: string,
): Promise<Page> {
  const found = find(view.state, blockId);
  if (!found) throw new Error("No such block");

  await append(view, `${NAMESPACE}block.edited`, { id: blockId, text });
  return pageOf(view, found.page);
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
  view: PagesView,
  blockId: string,
): Promise<Page> {
  const found = find(view.state, blockId);
  if (!found) throw new Error("No such block");

  await append(view, `${NAMESPACE}block.deleted`, { id: blockId });
  return pageOf(view, found.page);
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
  view: PagesView,
  blockId: string,
): Promise<Page> {
  const found = find(view.state, blockId);
  if (!found) throw new Error("No such block");
  const payload = indented(found.blocks, blockId);
  if (payload) await append(view, `${NAMESPACE}block.indented`, payload);
  return pageOf(view, found.page);
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
  view: PagesView,
  blockId: string,
): Promise<Page> {
  const found = find(view.state, blockId);
  if (!found) throw new Error("No such block");
  const payload = outdented(found.blocks, blockId);
  if (payload) await append(view, `${NAMESPACE}block.outdented`, payload);
  return pageOf(view, found.page);
}
