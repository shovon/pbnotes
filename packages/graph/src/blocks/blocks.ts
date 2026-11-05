/**
 * The block is the primitive, and this is what every block event shares: the
 * tree, the payloads, where a new block goes, and the moves. The events
 * themselves are in `events/blocks/`, one module each, with the list that
 * puts them together as the fold (#238).
 *
 * A page is not a record anywhere: it is a title that blocks carry, so pages
 * come into being by being named and go away by having nothing left on them.
 * That is why only a creation and a move say anything about a page: where a
 * block goes. Every other event names the block alone.
 *
 * Nothing here touches a log, a file, a device or a window. Both sides of the
 * app fold with it — main's fold is the truth, the renderer's `predict` is a
 * guess over it — and so does anyone else reading a folder. Two folds that
 * have to agree are one fold, or they drift.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field } from "../events/events.ts";
import { over } from "../over/over.ts";
import type { Check } from "../undo/undo.ts";
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
 * What the block fold reads and writes, which `Graph` is.
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

/**
 * `block` as `parent`'s first child, wherever `parent` is. Undefined when
 * `parent` is not in this subtree.
 */
export function under(
  blocks: Block[],
  parent: string,
  block: Block,
): Block[] | undefined {
  if (!locate(blocks, parent)) return undefined;
  return mapChildren(blocks, parent, (children) => [block, ...children]);
}

/** The block and everything under it, gone from wherever it sat. */
export function without(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) => ({ ...block, children: without(block.children, id) }));
}

/** One block's text replaced, wherever in the tree it is. */
export function retext(blocks: Block[], id: string, text: string): Block[] {
  return blocks.map((block) =>
    block.id === id
      ? { ...block, text }
      : { ...block, children: retext(block.children, id, text) },
  );
}

/** `parent`'s children put through `next`, wherever `parent` is. */
export function mapChildren(
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

// ── The payloads ────────────────────────────────────────────────────────────

/** `define` and `slice` for the block events. */
export const BLOCK = over<BlockState>();

/** Where the user wrote a block. It and a move are the events that carry a page. */
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
  /**
   * The block it was written under (#226). Alone, the block is its first
   * child. With `after`, `after` places it, and `parent` is where it goes if
   * `after` is not one of its children: the user wrote under `parent`, and
   * that stays true when `after` does not.
   */
  parent?: string;
  /**
   * The page's first top-level block (#231). Only with no `after` and no
   * `parent`, which say more precisely where it goes and win when given.
   * Absent means the end of the page.
   */
  first?: true;
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
 * Where the user moved a block, with its subtree, on its own page or another
 * (#252). The place fields mean what they mean on `block.created`, and with
 * none of them the block goes at the end of the page. The page is written
 * even for a move on the same page, so the payload says where the block ends
 * up without reading the graph.
 */
export type BlockMoved = { id: string; page: string } & Place;

/**
 * A string field of `payload`, `""` included, or undefined for anything else.
 * Every block event reads its fields through this; one that names a block
 * also refuses `""`, since no block is named that.
 */
export function stringField(payload: object, name: string): string | undefined {
  const value = field(payload, name);
  return typeof value === "string" ? value : undefined;
}

/**
 * The payload and the block it names, or undefined when it is not an object
 * or has no `id` that is a string. Every block event names a block. Any field
 * an event does not read is ignored, the `page` the four after a creation
 * were once written with among them, so a `v: 1` payload still folds
 * (`blocks.test.ts` pins that).
 */
export function withId(payload: unknown): { payload: object; id: string } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const id = stringField(payload, "id");
  return id ? { payload, id } : undefined;
}

// ── Folding onto the page a block is on ─────────────────────────────────────

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
export function onBlock<S extends BlockState>(
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

/** Where `block.created` puts a block: after a sibling, under a parent, or first. */
export type Place = Pick<BlockCreated, "after" | "parent" | "first">;

/**
 * `blocks` with a new `block` in it: beneath `after` when that is one of
 * `parent`'s children (or there is no `parent`), else first under `parent`,
 * else at the end. `first`, with neither of the others, is the top of the
 * page. Never fails, so a creation always shows somewhere.
 */
export function placed(blocks: Block[], block: Block, { after, parent, first }: Place): Block[] {
  if (first && !after && !parent) return [block, ...blocks];
  const fits = after && (!parent || locate(blocks, after)?.parent?.id === parent);
  return (
    (fits && beside(blocks, after, block)) ||
    (parent && under(blocks, parent, block)) ||
    [...blocks, block]
  );
}

// ── Moves ───────────────────────────────────────────────────────────────────

/**
 * `blocks` with `block` at exactly `place`, or undefined when `place` names a
 * block `blocks` lacks, or an `after` that is not one of `parent`'s children.
 * Unlike `placed`, never falls back: a move to a place that is gone leaves
 * the block where its owner last saw it.
 */
export function placedAt(blocks: Block[], block: Block, { after, parent, first }: Place): Block[] | undefined {
  if (after) {
    const sibling = locate(blocks, after);
    if (!sibling || (parent && sibling.parent?.id !== parent)) return undefined;
    return beside(blocks, after, block);
  }
  if (parent) return under(blocks, parent, block);
  return first ? [block, ...blocks] : [...blocks, block];
}

/** Whether the block `id` already sits exactly where `place` on `page` says. */
export function sitsAt(state: BlockState, id: string, page: string, { after, parent, first }: Place): boolean {
  const found = find(state, id);
  if (!found || canonicalize(found.page) !== canonicalize(page)) return false;
  const { siblings, at } = found;
  const hangs = found.parent?.id;
  if (after) return siblings[at - 1]?.id === after && (!parent || hangs === parent);
  if (parent) return hangs === parent && at === 0;
  return !hangs && (first ? at === 0 : at === siblings.length - 1);
}

/**
 * What indenting a block is: filed under the sibling above it. Undefined for
 * a block first among its siblings, or one the page lacks. Here, because
 * whoever predicts a move has to resolve it exactly as whoever records it.
 */
export function indented(blocks: Block[], id: string): BlockIndented | undefined {
  const found = locate(blocks, id);
  return found && found.at > 0 ? { id, parent: found.siblings[found.at - 1].id } : undefined;
}

/** What outdenting is: directly beneath the block it hangs under. */
export function outdented(blocks: Block[], id: string): BlockOutdented | undefined {
  const parent = locate(blocks, id)?.parent;
  return parent ? { id, after: parent.id } : undefined;
}

// ── What undo reads (#233) ──────────────────────────────────────────────────

/** Where the block `id` sits in `state`, as a `block.created` would put it back there. */
export function placeOf(state: BlockState, id: string): Place | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const above = found.siblings[found.at - 1];
  const parent = found.parent?.id;
  if (above) return { after: above.id, ...(parent ? { parent } : {}) };
  return parent ? { parent } : { first: true };
}

/** The text of the block `id`, or undefined when it is gone. */
export function textOf(state: BlockState, id: string): string | undefined {
  const found = find(state, id);
  return found?.siblings[found.at].text;
}

/** Where a block is: its page, parent, and the siblings either side. Undefined when it is gone. */
export function position(state: BlockState, id: string): string | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const { siblings, at } = found;
  return JSON.stringify([
    canonicalize(found.page),
    found.parent?.id ?? null,
    siblings[at - 1]?.id ?? null,
    siblings[at + 1]?.id ?? null,
  ]);
}

/** A block's text and its whole subtree, ids and text. Undefined when it is gone. */
export function tree(state: BlockState, id: string): string | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const shape = (block: Block): unknown => [block.id, block.text, block.children.map(shape)];
  return JSON.stringify(shape(found.siblings[found.at]));
}

/** Every id in `blocks`, at every depth. */
export function ids(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => [block.id, ...ids(block.children)]);
}

/** A check that none of `gone` is anywhere in `now`: nobody brought them back. */
export function stillGone(gone: readonly string[]): Check<BlockState> {
  return (now) => gone.every((id) => !find(now, id));
}
