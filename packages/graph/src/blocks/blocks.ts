/**
 * The block is the primitive, and this is what every block event shares: the
 * fold state, the payloads, where a new block goes, and what undo reads. The
 * events themselves are the folders beside this file, one module each, and
 * `slice.ts` is the list that puts them together as the fold (#238).
 *
 * The fold keeps blocks flat (#276): a forest of block ids grouped by page,
 * and each block's text beside it. A write costs the rows it touches, never
 * a copy of the page it is on. A page is read as a tree (`tree.ts`) when
 * something asks for it.
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

import { canonicalize } from "../titles/canonicalize.ts";
import { field } from "../event/event.ts";
import * as forest from "../forest/forest.ts";
import type { Forest, Spot } from "../forest/forest.ts";
import * as map from "../immutable/immutable.ts";
import type { ImmutableMap } from "../immutable/immutable.ts";
import { over } from "../event/over.ts";
import type { Check } from "../undo/undo.ts";
import { spelled } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";
import type { Block } from "./tree.ts";

export type { Block, Page } from "./tree.ts";

/**
 * What the block fold reads and writes, which `Graph` is.
 *
 * `forest` holds every block id, grouped by its page's `canonicalize`d title,
 * nested as the user nested them; `texts` holds each block's text by id. A
 * page that has had a block on it stays a group, empty, until it is deleted.
 * Every group is a key in `titles`, but not the other way round: a link
 * names a page before anyone writes on it.
 *
 * Plain data throughout (`immutable/`), so it survives a structured clone, and
 * a title or id of `__proto__` is an ordinary key (#62).
 */
export type BlockState = {
  readonly forest: Forest;
  readonly texts: ImmutableMap<string>;
  readonly titles: Titles;
};

/** The blocks of a state with none. */
export function noBlocks(): Pick<BlockState, "forest" | "texts"> {
  return { forest: forest.empty(), texts: map.empty() };
}

// ── Reading pages ───────────────────────────────────────────────────────────

/** The blocks under `ids`, as trees. */
function grown(holds: Pick<BlockState, "forest" | "texts">, ids: readonly string[]): Block[] {
  return ids.map((id) => ({
    id,
    text: map.get(holds.texts, id) ?? "",
    children: grown(holds, forest.childrenOf(holds.forest, id)),
  }));
}

/** The blocks on a page, as trees: empty for one nothing has been written to. */
export function blocksOn(holds: Pick<BlockState, "forest" | "texts">, title: string): Block[] {
  return pageBlocks(holds, canonicalize(title));
}

/** `blocksOn`, by a key already `canonicalize`d. */
export function pageBlocks(holds: Pick<BlockState, "forest" | "texts">, key: string): Block[] {
  return grown(holds, forest.rootsOf(holds.forest, key));
}

/** The block `id` with everything under it, as a tree: undefined when it is gone. */
export function treeOf(holds: Pick<BlockState, "forest" | "texts">, id: string): Block | undefined {
  return forest.has(holds.forest, id) ? grown(holds, [id])[0] : undefined;
}

/** The text of the block `id`, or undefined when it is gone. */
export function textOf(holds: Pick<BlockState, "forest" | "texts">, id: string): string | undefined {
  return forest.has(holds.forest, id) ? map.get(holds.texts, id) : undefined;
}

/** The `canonicalize`d title of the page the block `id` is on: undefined when it is gone. */
export function keyOf(holds: Pick<BlockState, "forest">, id: string): string | undefined {
  return forest.node(holds.forest, id)?.group;
}

/**
 * Where a block sits, and which page it sits on: the title it shows, its
 * `canonicalize`d key, the block it hangs under (none at the top level), and
 * the ids of it and its siblings, in order, with its index among them.
 */
export type Found = {
  page: string;
  key: string;
  parent?: string;
  siblings: readonly string[];
  at: number;
};

/**
 * The block, wherever in the project it is. A block id is unique across every
 * page, which is why nothing after `block.created` carries a page.
 */
export function find(state: BlockState, id: string): Found | undefined {
  const it = forest.node(state.forest, id);
  if (!it) return undefined;
  const { list, at } = forest.siblingsOf(state.forest, id)!;
  return {
    page: spelled(state.titles, it.group),
    key: it.group,
    ...(it.parent === undefined ? {} : { parent: it.parent }),
    siblings: list,
    at,
  };
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

// ── Places ──────────────────────────────────────────────────────────────────

/** Where `block.created` puts a block: after a sibling, under a parent, or first. */
export type Place = Pick<BlockCreated, "after" | "parent" | "first">;

/** Whether the block `id` is on the page whose key is `key`. */
export function isOn(holds: Pick<BlockState, "forest">, id: string, key: string): boolean {
  return keyOf(holds, id) === key;
}

/**
 * Where a new block goes on the page `key`: beneath `after` when that is on
 * the page and one of `parent`'s children (or there is no `parent`), else
 * first under `parent` when that is on the page, else at the end. `first`,
 * with neither of the others, is the top of the page. Never fails, so a
 * creation always shows somewhere.
 */
export function placed(holds: Pick<BlockState, "forest">, key: string, { after, parent, first }: Place): Spot {
  if (first && !after && !parent) return { group: key, at: "first" };
  if (after && isOn(holds, after, key) && (!parent || forest.node(holds.forest, after)!.parent === parent)) {
    return { after };
  }
  if (parent && isOn(holds, parent, key)) return { under: parent, at: "first" };
  return { group: key, at: "last" };
}

/**
 * Exactly where `place` on the page `key` is, or undefined when it names a
 * block the page lacks, or an `after` that is not one of `parent`'s children.
 * Unlike `placed`, never falls back: a move to a place that is gone leaves
 * the block where its owner last saw it.
 */
export function placedAt(holds: Pick<BlockState, "forest">, key: string, { after, parent, first }: Place): Spot | undefined {
  if (after) {
    if (!isOn(holds, after, key)) return undefined;
    if (parent && forest.node(holds.forest, after)!.parent !== parent) return undefined;
    return { after };
  }
  if (parent) return isOn(holds, parent, key) ? { under: parent, at: "first" } : undefined;
  return { group: key, at: first ? "first" : "last" };
}

/** Whether the block `id` already sits exactly where `place` on `page` says. */
export function sitsAt(state: BlockState, id: string, page: string, { after, parent, first }: Place): boolean {
  const found = find(state, id);
  if (!found || found.key !== canonicalize(page)) return false;
  const { siblings, at, parent: hangs } = found;
  if (after) return siblings[at - 1] === after && (!parent || hangs === parent);
  if (parent) return hangs === parent && at === 0;
  return hangs === undefined && (first ? at === 0 : at === siblings.length - 1);
}

/** The state with the block `id` and everything under it gone, texts and all. */
export function withoutTree<S extends BlockState>(state: S, id: string): S {
  let texts = state.texts;
  for (const gone of forest.subtree(state.forest, id)) texts = map.remove(texts, gone);
  return { ...state, forest: forest.removeTree(state.forest, id), texts };
}

/** The ids of the block `id` and everything under it. */
export function subtreeOf(holds: Pick<BlockState, "forest">, id: string): string[] {
  return forest.subtree(holds.forest, id);
}

// ── What undo reads (#233) ──────────────────────────────────────────────────

/** Where the block `id` sits in `state`, as a `block.created` would put it back there. */
export function placeOf(state: BlockState, id: string): Place | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const above = found.siblings[found.at - 1];
  const parent = found.parent;
  if (above) return { after: above, ...(parent ? { parent } : {}) };
  return parent ? { parent } : { first: true };
}

/** Where a block is: its page, parent, and the siblings either side. Undefined when it is gone. */
export function position(state: BlockState, id: string): string | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const { siblings, at } = found;
  return JSON.stringify([found.key, found.parent ?? null, siblings[at - 1] ?? null, siblings[at + 1] ?? null]);
}

/** A block's text and its whole subtree, ids and text. Undefined when it is gone. */
export function tree(state: BlockState, id: string): string | undefined {
  const block = treeOf(state, id);
  if (!block) return undefined;
  const shape = (it: Block): unknown => [it.id, it.text, it.children.map(shape)];
  return JSON.stringify(shape(block));
}

/** A check that none of `gone` is anywhere in `now`: nobody brought them back. */
export function stillGone(gone: readonly string[]): Check<BlockState> {
  return (now) => gone.every((id) => !forest.has(now.forest, id));
}
