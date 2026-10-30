/**
 * Writing blocks: a pure builder per event, and a command per keystroke that
 * checks the page before it builds and dispatches.
 */
import { NAMESPACE } from "../events/events.ts";
import type { Named } from "../events/events.ts";
import { BLOCK_HANDLES, blocksOn, find, indented, locate, outdented } from "./blocks.ts";
import type { Bare, BlockIndented, BlockOutdented, BlockState, Found, Page, PageEvent } from "./blocks.ts";
import { getPage } from "./queries.ts";

/**
 * What the commands need: the state as it stands, and a way to append one of
 * this fold's events. `PagesView` is one.
 */
export type BlocksView = {
  readonly state: BlockState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: PageEvent["type"], payload: unknown): Promise<unknown>;
};

/** One event as it is written: schema type and payload, plus the `v` the gate reads. */
type Built<T extends string> = Extract<PageEvent, { type: Named<T> }> & { v: number };

/**
 * The one place an event is put together. The payload is typed against the
 * schema and `v` comes from `BLOCK_HANDLES`, because a payload that drifts
 * folds to nothing and a hand-typed `v` the gate refuses skips this build's
 * own writes. Reads no clock and no randomness.
 */
function build<T extends Bare["type"]>(
  name: T,
  payload: Extract<Bare, { type: T }>["payload"],
): Built<T> {
  const type = `${NAMESPACE}${name}` as Named<T>;
  return { v: BLOCK_HANDLES[type], type, payload } as Built<T>;
}

/**
 * The `block.created` event: the same bytes `addBlock` writes. A writer with
 * no fold (the CLI) can write a valid one if it trusts its own `after` and
 * `id`. An absent `after` is left off, so an appended block writes the bytes
 * it always did.
 */
export function blockCreated(
  page: string,
  text: string,
  after: string | undefined,
  id: string,
): Built<"block.created"> {
  return build("block.created", { page, id, text, ...(after ? { after } : {}) });
}

/** The `block.edited` event: `id`'s text is now `text`. */
export function blockEdited(id: string, text: string): Built<"block.edited"> {
  return build("block.edited", { id, text });
}

/** The `block.deleted` event: the user is done with `id`. */
export function blockDeleted(id: string): Built<"block.deleted"> {
  return build("block.deleted", { id });
}

/** The `block.indented` event for a move `indented` resolved. */
export function blockIndented(payload: BlockIndented): Built<"block.indented"> {
  return build("block.indented", payload);
}

/** The `block.outdented` event for a move `outdented` resolved. */
export function blockOutdented(payload: BlockOutdented): Built<"block.outdented"> {
  return build("block.outdented", payload);
}

function append(view: BlocksView, event: Built<string>): Promise<unknown> {
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
  eventFor: (found: Found) => Built<string> | undefined,
): Promise<Page> {
  const found = find(view.state, blockId);
  if (!found) throw new Error("No such block");
  const event = eventFor(found);
  if (event) await append(view, event);
  return getPage(view.state, found.page);
}

/**
 * Writes a new block at the end of the page or directly beneath `after`.
 * Refuses an `after` not on this page, and an id the ledger already has. The
 * id is always the caller's: the block on disk has to be the one on screen.
 */
export async function addBlock(
  view: BlocksView,
  title: string,
  text: string,
  after: string | undefined,
  id: string,
): Promise<Page> {
  if (after && !locate(blocksOn(view.state, title), after)) {
    throw new Error("No such block");
  }
  if (find(view.state, id)) throw new Error("That block already exists");
  // dispatch appends before it folds, so the page handed back can never show
  // something a crash takes.
  await append(view, blockCreated(title, text, after, id));
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
