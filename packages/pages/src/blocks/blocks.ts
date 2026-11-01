/**
 * The block is the primitive, and this is everything that knows what one is:
 * the event schema, the tree operations a fold is made of, and the fold.
 *
 * A page is not a record anywhere: it is a title that blocks carry, so pages
 * come into being by being named and go away by having nothing left on them.
 * That is why only a creation says anything about a page, and why every event
 * after it names the block alone.
 *
 * Nothing here touches a log, a file, a device or a window. Both sides of the
 * app fold with it — main's fold is the truth, the renderer's `predict` is a
 * guess over it — and so does anyone else reading a folder. Two folds that
 * have to agree are one fold, or they drift.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field, NAMESPACE, unnamed } from "../events/events.ts";
import type { Named } from "../events/events.ts";
import { read } from "../reading/reading.ts";
import { spell } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";

export type Block = {
  id: string;
  text: string;
  /** Nested beneath this one, in the order they fold. Empty for a leaf. */
  children: Block[];
};

export type Page = {
  /**
   * What names the page: a local `YYYY-MM-DD` for a journal day, otherwise
   * the first spelling the fold saw for it. Case does not matter (see
   * `canonicalize`), but the log keeps each title as it was typed.
   */
  title: string;
  /** In the order they belong on the page, which is the order they fold. */
  blocks: Block[];
};

/**
 * What the block fold reads and writes, which `Pages` is.
 *
 * `Map`, not a plain object: a title is whatever was typed, and `__proto__`
 * is a key every object inherits (#62). Every key in `blocks` is in `titles`,
 * but not the other way round: a link names a page before anyone writes on it.
 */
export type BlockState = {
  readonly blocks: Map<string, Block[]>;
  readonly titles: Titles;
};

// ── The tree ────────────────────────────────────────────────────────────────

/**
 * Where a block sits: the array it is in, its index there, and the block it
 * hangs under (undefined at the top level). Exported because the app walks
 * the tree the same way the fold does, and two walks that must agree drift.
 */
export function locate(
  blocks: Block[],
  id: string,
  parent?: Block,
): { siblings: Block[]; at: number; parent?: Block } | undefined {
  const at = blocks.findIndex((block) => block.id === id);
  if (at !== -1) return { siblings: blocks, at, parent };
  for (const block of blocks) {
    const hit = locate(block.children, id, block);
    if (hit) return hit;
  }
  return undefined;
}

/** The deepest last descendant: what renders directly above the next block. */
export function lastLeaf(block: Block): Block {
  let last = block;
  while (last.children.length > 0) {
    last = last.children[last.children.length - 1];
  }
  return last;
}

/**
 * `block` spliced in directly after `after`, as its sibling, at whatever depth
 * `after` sits. Undefined when `after` is not in this subtree.
 */
export function beside(
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
export function without(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) => ({ ...block, children: without(block.children, id) }));
}

/** One block's text replaced, wherever in the tree it is. */
function retext(blocks: Block[], id: string, text: string): Block[] {
  return blocks.map((block) =>
    block.id === id
      ? { ...block, text }
      : { ...block, children: retext(block.children, id, text) },
  );
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

// ── Pages of blocks ─────────────────────────────────────────────────────────

/** The blocks on a page, empty for one nothing has been written to. */
export function blocksOn(holds: Pick<BlockState, "blocks">, title: string): Block[] {
  return holds.blocks.get(canonicalize(title)) ?? [];
}

/** Where a block sits, and which page it sits on, by the title it shows. */
export type Found = NonNullable<ReturnType<typeof locate>> & {
  page: string;
  blocks: Block[];
};

/**
 * The block, wherever in the project it is. A block id is unique across every
 * page, which is why nothing after `block.created` carries a page.
 *
 * ponytail: scans every page per event, so a replay is O(blocks × events).
 * Keep a block id → page index in the fold state if a long log ever shows up
 * as a slow launch.
 */
export function find(state: BlockState, id: string): Found | undefined {
  for (const [key, blocks] of state.blocks) {
    const where = locate(blocks, id);
    if (where) return { page: state.titles.get(key) ?? key, blocks, ...where };
  }
  return undefined;
}

// ── The events ──────────────────────────────────────────────────────────────

/** Where the user wrote a block. The only event that carries a page. */
export type BlockCreated = {
  page: string;
  id: string;
  text: string;
  /**
   * The sibling it was written directly beneath, at whatever depth. Absent
   * means the end of the page. A position, never an index: which block the
   * user wrote beneath stays true forever, an index does not.
   */
  after?: string;
};

/** The later of two facts about one block's text. The earlier one stays. */
export type BlockEdited = { id: string; text: string };

/** That the user was done with it. Nothing leaves the disk. */
export type BlockDeleted = { id: string };

/** The block it became the last child of, resolved when the user indented. */
export type BlockIndented = { id: string; parent: string };

/** The block it used to hang under, and now sits directly beneath. */
export type BlockOutdented = { id: string; after: string };

/**
 * Every event this fold understands, and its payload. The four after a
 * creation were once written with a `page` too; it is not read, so a `v1`
 * payload still folds (`blocks.test.ts` pins that).
 */
export type PageEvent =
  | { type: Named<"block.created">; payload: BlockCreated }
  | { type: Named<"block.edited">; payload: BlockEdited }
  | { type: Named<"block.deleted">; payload: BlockDeleted }
  | { type: Named<"block.indented">; payload: BlockIndented }
  | { type: Named<"block.outdented">; payload: BlockOutdented };

/** A `PageEvent` with the namespace off its type. */
export type Bare<E = PageEvent> = E extends {
  type: `${typeof NAMESPACE}${infer T}`;
  payload: infer P;
}
  ? { type: T; payload: P }
  : never;

/**
 * Event type → the payload `v` this build folds, which is also the `v` it
 * writes. Keyed on `PageEvent['type']`, so it cannot drift from the schema.
 * The block half of `HANDLES`; the gate that reads it is `pagesFold`.
 */
export const BLOCK_HANDLES: Record<PageEvent["type"], number> = {
  [`${NAMESPACE}block.created`]: 1,
  // 2 since the page came off the payload: an older build handed one would
  // look up a page of `undefined` and drop the text without a word. At `v: 2`
  // its own gate refuses the event instead.
  [`${NAMESPACE}block.edited`]: 2,
  [`${NAMESPACE}block.deleted`]: 2,
  [`${NAMESPACE}block.indented`]: 2,
  [`${NAMESPACE}block.outdented`]: 2,
};

// ── The fold: parse, then apply ─────────────────────────────────────────────

/** A string field of the payload, or undefined for anything else. */
function string(payload: object, name: string): string | undefined {
  const value = field(payload, name);
  return typeof value === "string" ? value : undefined;
}

/**
 * A block event as this build reads it, or undefined for anything else: not
 * one of ours, or malformed. A malformed event is skipped whole, never folded
 * in part. The types say what *this build writes*; what arrives in a shared
 * folder was written by something else, and may be anything.
 *
 * Two leniencies, both so that a block is never dropped that could be shown:
 * a page that is not a string is filed under its `String` (it always was),
 * and an `after` that is not a string means the end of the page.
 */
function parse(event: { type: string; payload: unknown }): Bare | undefined {
  const name = unnamed(event.type);
  const payload = event.payload;
  if (!name || typeof payload !== "object" || payload === null) return undefined;
  const id = string(payload, "id");
  if (!id) return undefined;

  switch (name) {
    case "block.created": {
      const text = string(payload, "text");
      if (text === undefined) return undefined;
      const page = String(field(payload, "page"));
      const after = string(payload, "after");
      return { type: name, payload: { page, id, text, ...(after ? { after } : {}) } };
    }
    case "block.edited": {
      const text = string(payload, "text");
      return text === undefined ? undefined : { type: name, payload: { id, text } };
    }
    case "block.deleted":
      return { type: name, payload: { id } };
    case "block.indented": {
      const parent = string(payload, "parent");
      return parent ? { type: name, payload: { id, parent } } : undefined;
    }
    case "block.outdented": {
      const after = string(payload, "after");
      return after ? { type: name, payload: { id, after } } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Applies `change` to the page the block turned out to be on. A block that is
 * not in the project, or an `undefined` from `change`, leaves the state as it
 * was.
 *
 * The page comes from `find` and never from a payload: a page on an edit
 * would be where the block sat on the machine that wrote it, and a miss drops
 * the user's text. This is the only place that chooses which page a fold
 * writes to.
 */
function onBlock<S extends BlockState>(
  state: S,
  id: string,
  change: (found: Found) => Block[] | undefined,
): S {
  const found = find(state, id);
  if (!found) return state;
  const blocks = change(found);
  return blocks
    ? { ...state, blocks: new Map(state.blocks).set(canonicalize(found.page), blocks) }
    : state;
}

/** Adding a type to `PageEvent` without a case for it stops the build here. */
function foreign(_event: never, state: unknown): never {
  return state as never;
}

/** One parsed event applied. Pure, and never changes what it is handed. */
function apply<S extends BlockState>(state: S, it: Bare): S {
  switch (it.type) {
    case "block.created": {
      const { page, id, text, after } = it.payload;
      const blocks = blocksOn(state, page);
      const block: Block = { id, text, children: [] };
      // `addBlock` refuses an `after` the page lacks, so a miss here is a log
      // written by something else. Append rather than drop: a block in the
      // wrong place can be moved, one the fold discarded is gone.
      const next = (after && beside(blocks, after, block)) || [...blocks, block];
      return {
        ...state,
        blocks: new Map(state.blocks).set(canonicalize(page), next),
        // The page before its links: it is where the user was writing.
        titles: spell(state.titles, [page, ...read(text).links]),
      };
    }

    case "block.edited": {
      const { id, text } = it.payload;
      const next = onBlock(state, id, ({ blocks }) => retext(blocks, id, text));
      // An edit to a block the ledger lacks names nothing either.
      if (next === state) return state;
      return { ...next, titles: spell(next.titles, read(text).links) };
    }

    case "block.deleted": {
      // A plain filter, no tombstone, and the subtree goes with it. Every
      // event that built them is still on disk.
      const { id } = it.payload;
      return onBlock(state, id, ({ blocks }) => without(blocks, id));
    }

    case "block.indented": {
      const { id, parent } = it.payload;
      return onBlock(state, id, (found) => {
        // A parent on another page would be a move across pages, and there
        // is no such event yet.
        if (!locate(found.blocks, parent)) return undefined;
        // Read before the detach, so the whole subtree moves.
        const moving = found.siblings[found.at];
        // Under itself or its own subtree: two machines each indenting one
        // block under the other before they sync writes this (#62).
        if (parent === id || locate(moving.children, parent)) return undefined;
        return mapChildren(without(found.blocks, id), parent, (children) => [
          ...children,
          moving,
        ]);
      });
    }

    case "block.outdented": {
      const { id, after } = it.payload;
      return onBlock(state, id, (found) => {
        if (!found.parent) return undefined;
        // The siblings below it come along as its own children, or they would
        // be stranded above it and the page would read in a different order.
        const moving = found.siblings[found.at];
        const trailing = found.siblings.slice(found.at + 1);
        const outdented = { ...moving, children: [...moving.children, ...trailing] };
        const trimmed = mapChildren(found.blocks, found.parent.id, (children) =>
          children.slice(0, found.at),
        );
        return beside(trimmed, after, outdented) ?? [...trimmed, outdented];
      });
    }

    default:
      return foreign(it, state);
  }
}

/**
 * The block fold: one event in, the state out. Hands back `state` itself for
 * any event that is not a well-formed block event. Whatever else `state`
 * holds is carried through as it is.
 */
export function reduce<S extends BlockState>(
  state: S,
  event: { type: string; payload: unknown },
): S {
  const parsed = parse(event);
  return parsed ? apply(state, parsed) : state;
}

// ── Moves, and predicting them ──────────────────────────────────────────────

/**
 * What indenting a block is: filed under the sibling above it. Undefined for
 * a block first among its siblings, or one the page lacks. Here, because
 * whoever predicts a move has to resolve it exactly as whoever records it.
 */
export function indented(
  blocks: Block[],
  id: string,
): BlockIndented | undefined {
  const found = locate(blocks, id);
  return found && found.at > 0
    ? { id, parent: found.siblings[found.at - 1].id }
    : undefined;
}

/** What outdenting is: directly beneath the block it hangs under. */
export function outdented(
  blocks: Block[],
  id: string,
): BlockOutdented | undefined {
  const parent = locate(blocks, id)?.parent;
  return parent ? { id, after: parent.id } : undefined;
}

/** One of this fold's event types, with a payload `landed` can read. */
function isBlockEvent(event: { type: string; payload: unknown }): event is PageEvent {
  return (
    Object.hasOwn(BLOCK_HANDLES, event.type) &&
    typeof event.payload === "object" &&
    event.payload !== null
  );
}

/**
 * Whether the page already shows what `event` did. Asked only of the events
 * that are not safe to fold twice.
 */
function landed(state: BlockState, event: PageEvent): boolean {
  const found = find(state, event.payload.id);
  switch (event.type) {
    case `${NAMESPACE}block.created`:
      return !!found;
    case `${NAMESPACE}block.indented`:
      return found?.parent?.id === event.payload.parent;
    case `${NAMESPACE}block.outdented`:
      return found?.siblings[found.at - 1]?.id === event.payload.after;
    default:
      return false;
  }
}

/**
 * The page as it will stand once `events` are recorded: the renderer's unsent
 * writes, folded over the page main last sent. A guess, thrown away when each
 * write settles. `landed` keeps an event the page already holds from being
 * drawn twice in the moment before it is dropped.
 *
 * Any other event is passed over, so a view can hand over every write it has
 * in flight, a property's among them, without sorting them first.
 */
export function predict(
  page: Page,
  events: readonly { type: string; payload: unknown }[],
): Page {
  if (events.length === 0) return page;
  const key = canonicalize(page.title);
  let state: BlockState = {
    blocks: new Map([[key, page.blocks]]),
    titles: new Map([[key, page.title]]),
  };
  for (const event of events) {
    if (!isBlockEvent(event)) continue;
    if (!landed(state, event)) state = reduce(state, event);
  }
  return { ...page, blocks: blocksOn(state, page.title) };
}
