/**
 * Writing blocks: a command per keystroke that checks the page before it
 * builds and dispatches. Each event's builder is its own module.
 */
import type { Written } from "../over/over.ts";
import { blocksOn, find, indented, locate, outdented } from "./blocks.ts";
import type { BlockState, Found, Page } from "./blocks.ts";
import { getPage } from "./queries.ts";
import type { PageEvent } from "./slice.ts";
import { blockCreated } from "./created/created.ts";
import { blockEdited } from "./edited/edited.ts";
import { blockDeleted } from "./deleted/deleted.ts";
import { blockIndented } from "./indented/indented.ts";
import { blockOutdented } from "./outdented/outdented.ts";

/**
 * What the commands need: the state as it stands, and a way to append one of
 * this fold's events. `GraphView` is one.
 */
export type BlocksView = {
  readonly state: BlockState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: PageEvent["type"], payload: unknown): Promise<unknown>;
};

/** A block event as a builder hands it back. */
type Built = Written<PageEvent["type"], unknown>;

function append(view: BlocksView, event: Built): Promise<unknown> {
  return view.dispatch(event.v, event.type, event.payload);
}

/**
 * The shape of every command on an existing block: refuse one the ledger
 * lacks, write the event `eventFor` makes (none when the keystroke changes
 * nothing, so the log does not collect events that mean nothing), and hand
 * back the page the block is on.
 */
async function onExisting(
  view: BlocksView,
  blockId: string,
  eventFor: (found: Found) => Built | undefined,
): Promise<Page> {
  const found = find(view.state, blockId);
  if (!found) throw new Error("No such block");
  const event = eventFor(found);
  if (event) await append(view, event);
  return getPage(view.state, found.page);
}

/**
 * Writes a new block at the end of the page, directly beneath `after`, as
 * `parent`'s first child, or with `first` at the top of the page. With both
 * `after` and `parent`, `after` has to be one of `parent`'s children; `first`
 * with either is refused, since they would win and it would mean nothing.
 * Refuses an `after` or `parent` not on this page, and an id the ledger
 * already has. The id is always the caller's: the block on disk has to
 * be the one on screen.
 */
export async function addBlock(
  view: BlocksView,
  title: string,
  text: string,
  after: string | undefined,
  id: string,
  parent?: string,
  first?: boolean,
): Promise<Page> {
  if (first && (after || parent)) {
    throw new Error("A first block cannot have an after or a parent");
  }
  const blocks = blocksOn(view.state, title);
  const sibling = after ? locate(blocks, after) : undefined;
  if (after && !sibling) throw new Error("No such block");
  if (parent && !locate(blocks, parent)) throw new Error("No such block");
  if (after && parent && sibling?.parent?.id !== parent) {
    throw new Error("That block is not a child of the parent");
  }
  if (find(view.state, id)) throw new Error("That block already exists");
  // dispatch appends before it folds, so the page handed back can never show
  // something a crash takes.
  await append(view, blockCreated(title, text, after, id, parent, first));
  return getPage(view.state, title);
}

/** Rewrites a block's text. The block is found by id, on whatever page it is. */
export function editBlock(view: BlocksView, blockId: string, text: string): Promise<Page> {
  return onExisting(view, blockId, () => blockEdited(blockId, text));
}

/** Removes a block and its subtree from view. Nothing is taken off disk. */
export function deleteBlock(view: BlocksView, blockId: string): Promise<Page> {
  return onExisting(view, blockId, () => blockDeleted(blockId));
}

/**
 * Moves a block under the sibling above it, children and all. The event
 * records the resolved parent, not "Tab was pressed". A block first among its
 * siblings writes nothing.
 */
export function indentBlock(view: BlocksView, blockId: string): Promise<Page> {
  return onExisting(view, blockId, (found) => {
    const payload = indented(found.blocks, blockId);
    return payload && blockIndented(payload);
  });
}

/**
 * Brings a block out a level, directly beneath what it hung under, taking the
 * siblings below it as its children. A top-level block writes nothing.
 */
export function outdentBlock(view: BlocksView, blockId: string): Promise<Page> {
  return onExisting(view, blockId, (found) => {
    const payload = outdented(found.blocks, blockId);
    return payload && blockOutdented(payload);
  });
}
