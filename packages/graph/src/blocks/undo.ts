/**
 * Undoing block events (#233): the inverse of each, and what a step that
 * wrote one must still find to be undone. Also how a block and its subtree
 * are written back, which `page.deleted`'s undo uses too.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { NAMESPACE, stringOf } from "../events/events.ts";
import type { Batched } from "../batch/batch.ts";
import { same } from "../undo/undo.ts";
import type { Check, Undo } from "../undo/undo.ts";
import { find } from "./blocks.ts";
import type { Block, BlockState, PageEvent } from "./blocks.ts";
import {
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockOutdented,
} from "./commands.ts";

// ── Putting blocks back ─────────────────────────────────────────────────────

/** Where `block.created` puts a block back: after a sibling, under a parent, or first. */
export type Place = { after?: string; parent?: string; first?: true };

/** Where the block `id` sits in `state`, as a `block.created` would put it back there. */
function placeOf(state: BlockState, id: string): Place | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const above = found.siblings[found.at - 1];
  const parent = found.parent?.id;
  if (above) return { after: above.id, ...(parent ? { parent } : {}) };
  return parent ? { parent } : { first: true };
}

/**
 * `block` and its subtree as `block.created` events on `page`, top-down,
 * with the same ids and text: the block at `place`, then each child, the
 * first under its parent and the rest after the sibling above it.
 */
export function recreate(page: string, block: Block, place: Place): Batched[] {
  const out: Batched[] = [
    blockCreated(page, block.text, place.after, block.id, place.parent, place.first),
  ];
  block.children.forEach((child, at) => {
    const above = block.children[at - 1];
    const under = above ? { after: above.id, parent: block.id } : { parent: block.id };
    out.push(...recreate(page, child, under));
  });
  return out;
}

/** Every id in `blocks`, at every depth. */
export function ids(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => [block.id, ...ids(block.children)]);
}

/** A check that none of `gone` is anywhere in `now`: nobody brought them back. */
export function stillGone(gone: readonly string[]): Check<BlockState> {
  return (now) => gone.every((id) => !find(now, id));
}

// ── What a step compares ────────────────────────────────────────────────────

/** The text of the block `id`, or undefined when it is gone. */
function textOf(state: BlockState, id: string): string | undefined {
  const found = find(state, id);
  return found?.siblings[found.at].text;
}

/** Where a block is: its page, parent, and the siblings either side. Undefined when it is gone. */
function position(state: BlockState, id: string): string | undefined {
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
function tree(state: BlockState, id: string): string | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const shape = (block: Block): unknown => [block.id, block.text, block.children.map(shape)];
  return JSON.stringify(shape(found.siblings[found.at]));
}

// ── One entry per block event ───────────────────────────────────────────────

/** How to undo each block event. Keyed on `PageEvent['type']`, so none is missed. */
export const BLOCK_UNDO: Record<PageEvent["type"], Undo<BlockState>> = {
  [`${NAMESPACE}block.created`]: {
    inverse: (state, { payload }) => {
      const id = stringOf(payload, "id");
      return find(state, id) ? [] : [blockDeleted(id)];
    },
    // Undone, it goes with its subtree: nobody may have written under it.
    touched: (_, { payload }) => {
      const id = stringOf(payload, "id");
      return [same((it) => tree(it, id)), same((it) => position(it, id))];
    },
  },

  [`${NAMESPACE}block.edited`]: {
    inverse: (state, { payload }) => {
      const id = stringOf(payload, "id");
      const was = textOf(state, id);
      return was === undefined || was === stringOf(payload, "text") ? [] : [blockEdited(id, was)];
    },
    // Its text only: a block moved since still holds.
    touched: (_, { payload }) => {
      const id = stringOf(payload, "id");
      return [same((it) => textOf(it, id))];
    },
  },

  [`${NAMESPACE}block.deleted`]: {
    inverse: (state, { payload }) => {
      const id = stringOf(payload, "id");
      const found = find(state, id);
      const place = placeOf(state, id);
      return found && place ? recreate(found.page, found.siblings[found.at], place) : [];
    },
    touched: (state, { payload }) => {
      const found = find(state, stringOf(payload, "id"));
      return found ? [stillGone(ids([found.siblings[found.at]]))] : [];
    },
  },

  [`${NAMESPACE}block.indented`]: {
    // A command indents under the sibling above, and coming back out after it
    // is where the block was: it is that sibling's last child, so the outdent
    // takes nothing along. An indent anywhere else, from another writer's
    // log, cannot be undone: no event moves a block to an arbitrary place.
    inverse: (state, { payload }) => {
      const id = stringOf(payload, "id");
      const parent = stringOf(payload, "parent");
      const found = find(state, id);
      if (!found) return [];
      return found.siblings[found.at - 1]?.id === parent
        ? [blockOutdented({ id, after: parent })]
        : undefined;
    },
    touched: (_, { payload }) => {
      const id = stringOf(payload, "id");
      return [same((it) => position(it, id))];
    },
  },

  [`${NAMESPACE}block.outdented`]: {
    // Back under the old parent as its last child, then each sibling the
    // outdent took along back out after it, last first, so they land in
    // their old order.
    inverse: (state, { payload }) => {
      const id = stringOf(payload, "id");
      const found = find(state, id);
      if (!found?.parent) return [];
      const along = found.siblings.slice(found.at + 1).reverse();
      return [
        blockIndented({ id, parent: found.parent.id }),
        ...along.map((sibling) => blockOutdented({ id: sibling.id, after: id })),
      ];
    },
    touched: (state, { payload }) => {
      const id = stringOf(payload, "id");
      const found = find(state, id);
      const along = found ? found.siblings.slice(found.at + 1).map((it) => it.id) : [];
      return [id, ...along].map((moved) => same((it) => position(it, moved)));
    },
  },
};
