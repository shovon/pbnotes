/**
 * Writing blocks: a command per keystroke that checks the page before it
 * builds and dispatches. Each event's builder is its own module.
 */
import type { Written } from "../over/over.ts";
import { blocksOn, find, ids, indented, locate, outdented, placedAt, sitsAt } from "./blocks.ts";
import type { Block, BlockState, Found, Page, Place } from "./blocks.ts";
import { getPage } from "./queries.ts";
import { reduce } from "../events/blocks/slice.ts";
import type { PageEvent } from "../events/blocks/slice.ts";
import { blockCreated } from "../events/blocks/created/created.ts";
import { blockEdited } from "../events/blocks/edited/edited.ts";
import { blockDeleted } from "../events/blocks/deleted/deleted.ts";
import { blockIndented } from "../events/blocks/indented/indented.ts";
import { blockOutdented } from "../events/blocks/outdented/outdented.ts";
import { blockMoved } from "../events/blocks/moved/moved.ts";
import { batch } from "../events/batch/batch.ts";
import type { BatchEvent } from "../events/batch/batch.ts";
import { pasted } from "./paste/paste.ts";
import type { PasteAt } from "./paste/paste.ts";

/**
 * What the commands need: the state as it stands, and a way to append one of
 * this fold's events. `GraphView` is one.
 */
export type BlocksView = {
  readonly state: BlockState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: PageEvent["type"] | BatchEvent["type"], payload: unknown): Promise<unknown>;
};

/** A block event as a builder hands it back, or a batch of them. */
type Built = Written<PageEvent["type"] | BatchEvent["type"], unknown>;

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
 * Removes several blocks, each with its subtree, as one record (#258): a
 * `batch` of `block.deleted`s, or the one event alone, so one undo brings
 * them all back. A block under another of `blockIds` goes with it and is not
 * deleted again, whatever order they came in or wherever the caller saw
 * them; a block the graph no longer has is passed over. Refuses when none of
 * them is left, as `deleteBlock` does for one.
 */
export async function deleteBlocks(view: BlocksView, blockIds: readonly string[]): Promise<void> {
  const gone = topMost(view.state, blockIds);
  if (gone.length === 0) throw new Error("No such block");
  const events = gone.map((id) => blockDeleted(id));
  await append(view, events.length === 1 ? events[0] : batch(events));
}

/**
 * Writes copied blocks on `title` as new ones (#261), nested as they were
 * copied, as one record, so one undo takes the paste back. `at` is a place
 * as `addBlock` means one, and refuses what it refuses, or `into` an empty
 * block on the page, which the first pasted block replaces (`paste.ts`).
 * Every id is the caller's, and refused when the graph has it or the paste
 * names it twice: a pasted block is a new block.
 */
export async function pasteBlocks(
  view: BlocksView,
  title: string,
  pasting: readonly Block[],
  at: PasteAt,
): Promise<void> {
  if (pasting.length === 0) throw new Error("Nothing to paste");
  const named = ids(pasting);
  if (new Set(named).size !== named.length) throw new Error("A pasted block is named twice");
  if (named.some((id) => find(view.state, id))) throw new Error("That block already exists");
  const blocks = blocksOn(view.state, title);
  if ("into" in at) {
    if (!locate(blocks, at.into)) throw new Error("No such block");
  } else {
    const { after, parent, first } = at;
    if (first && (after || parent)) {
      throw new Error("A first block cannot have an after or a parent");
    }
    const sibling = after ? locate(blocks, after) : undefined;
    if (after && !sibling) throw new Error("No such block");
    if (parent && !locate(blocks, parent)) throw new Error("No such block");
    if (after && parent && sibling?.parent?.id !== parent) {
      throw new Error("That block is not a child of the parent");
    }
  }
  const events = pasted(blocks, title, pasting, at) ?? [];
  if (events.length === 0) return;
  await append(view, events.length === 1 ? (events[0] as Built) : batch(events));
}

/**
 * Tab on several blocks (#259): each top-most one of `blockIds` filed under
 * the sibling above it, children and all, in the order given, as one record:
 * a `batch` of `block.indented`s, or the one event alone. Each is resolved
 * on the graph as the ones before it left it, so siblings selected together
 * go under the same block, in their order. All or nothing: when any of them
 * is first among its siblings, wherever it is, nothing is written, and that
 * is not an error, as with `indentBlock`. Refuses when none is left.
 */
export function indentBlocks(view: BlocksView, blockIds: readonly string[]): Promise<void> {
  return inTurn(view, blockIds, (state, id) => {
    const found = find(state, id);
    const payload = found && indented(found.blocks, id);
    return payload && blockIndented(payload);
  });
}

/**
 * Shift+Tab on several blocks (#260): each top-most one of `blockIds`
 * brought out a level, in the order given, as one record, taking the
 * siblings below it along as its children, as `outdentBlock` does. Each is
 * resolved on the graph as the ones before it left it, so selected siblings
 * come out in order: `a(b c d)` with `b` and `c` is `a b c(d)`, the same as
 * Shift+Tab on `b` and then on `c`. All or nothing: when any of them is
 * already top-level, on whatever page, nothing is written, and that is not
 * an error. Refuses when none is left.
 */
export function outdentBlocks(view: BlocksView, blockIds: readonly string[]): Promise<void> {
  return inTurn(view, blockIds, (state, id) => {
    const found = find(state, id);
    const payload = found && outdented(found.blocks, id);
    return payload && blockOutdented(payload);
  });
}

/**
 * The shape of every command on several blocks that moves each in turn: the
 * top-most of `blockIds`, each resolved by `eventFor` on the graph as the
 * ones before it left it, written as one record. Nothing is written when
 * `eventFor` has none for one of them: the step is all or nothing.
 */
async function inTurn(
  view: BlocksView,
  blockIds: readonly string[],
  eventFor: (state: BlockState, id: string) => Written<PageEvent["type"], unknown> | undefined,
): Promise<void> {
  const ids = topMost(view.state, blockIds);
  if (ids.length === 0) throw new Error("No such block");
  const events: Written<PageEvent["type"], unknown>[] = [];
  let state = view.state;
  for (const id of ids) {
    const event = eventFor(state, id);
    if (!event) return;
    events.push(event);
    state = reduce(state, event);
  }
  await append(view, events.length === 1 ? events[0] : batch(events));
}

/**
 * Of `blockIds`, the ones the graph has and that no other of them holds,
 * once each, in the order given. Asked of the graph, not of what a caller
 * saw: a linked reference shows a block without what it hangs under.
 */
function topMost(state: BlockState, blockIds: readonly string[]): string[] {
  const asked = new Set(blockIds);
  const held = (id: string): boolean => {
    for (let up = find(state, id)?.parent; up; up = find(state, up.id)?.parent) {
      if (asked.has(up.id)) return true;
    }
    return false;
  };
  return [...asked].filter((id) => find(state, id) && !held(id));
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

/**
 * Moves a block, with its subtree, to `place` on `title`: on its own page or
 * another (#252). The place means what it means to `addBlock`, and refuses
 * the same: an `after` or `parent` not on that page, an `after` that is not
 * `parent`'s child, and `first` with either. It also refuses a place inside
 * the block's own subtree, which the fold would ignore, and writes nothing
 * for a block already there. Hands back the page the block lands on.
 */
export async function moveBlock(
  view: BlocksView,
  blockId: string,
  title: string,
  place: Place = {},
): Promise<Page> {
  checkMove(view.state, [blockId], title, place);
  if (!sitsAt(view.state, blockId, title, place)) {
    await append(view, blockMoved({ id: blockId, page: title, ...place }));
  }
  return getPage(view.state, title);
}

/**
 * Moves several blocks, each with its subtree, to `place` on `title` (#269):
 * the top-most of `blockIds`, in the order given. The first goes to `place`,
 * and each next one directly beneath the one before it, at its depth, so
 * blocks that had gaps between them, or came from other pages, land
 * together. Written as one record: a `batch` of `block.moved`s, or the one
 * event alone, leaving out any block already where it would go.
 *
 * Refuses what `moveBlock` refuses, for any of them: a place inside one of
 * their subtrees among it. Refuses when none is left.
 */
export async function moveBlocks(
  view: BlocksView,
  blockIds: readonly string[],
  title: string,
  place: Place = {},
): Promise<void> {
  const moving = topMost(view.state, blockIds);
  checkMove(view.state, moving, title, place);
  const events: Written<PageEvent["type"], unknown>[] = [];
  let state = view.state;
  let at: Place = place;
  for (const id of moving) {
    if (!sitsAt(state, id, title, at)) {
      const event = blockMoved({ id, page: title, ...at });
      events.push(event);
      state = reduce(state, event);
    }
    const parent = find(state, id)?.parent?.id;
    at = { after: id, ...(parent === undefined ? {} : { parent }) };
  }
  if (events.length > 0) await append(view, events.length === 1 ? events[0] : batch(events));
}

/**
 * Throws unless every one of `blockIds` can move to `place` on `title`: each
 * is in the graph, the place is not inside any of their subtrees, and it
 * means something on that page, as it would to `addBlock`.
 */
function checkMove(state: BlockState, blockIds: readonly string[], title: string, place: Place): void {
  const { after, parent, first } = place;
  if (first && (after || parent)) {
    throw new Error("A first block cannot have an after or a parent");
  }
  if (blockIds.length === 0) throw new Error("No such block");
  const inside = new Set<string>();
  for (const id of blockIds) {
    const found = find(state, id);
    if (!found) throw new Error("No such block");
    for (const it of ids([found.siblings[found.at]])) inside.add(it);
  }
  if ((after && inside.has(after)) || (parent && inside.has(parent))) {
    throw new Error("A block cannot move into itself");
  }
  const blocks = blocksOn(state, title);
  if (after && !locate(blocks, after)) throw new Error("No such block");
  if (parent && !locate(blocks, parent)) throw new Error("No such block");
  const found = find(state, blockIds[0]);
  if (found && !placedAt(blocks, found.siblings[found.at], place)) {
    throw new Error("That block is not a child of the parent");
  }
}
