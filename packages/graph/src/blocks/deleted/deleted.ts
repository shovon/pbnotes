/**
 * `block.deleted`: the user was done with a block and its subtree.
 * Everything about the event, from reading its payload to undoing it (#238).
 */
import { namespaced } from "../../event/event.ts";
import type { Named } from "../../event/event.ts";
import type { Written } from "../../event/over.ts";
import * as forest from "../../forest/forest.ts";
import { BLOCK, find, placeOf, stillGone, subtreeOf, treeOf, withId, withoutTree } from "../blocks.ts";
import type { BlockDeleted } from "../blocks.ts";
import { recreate } from "../created/created.ts";

export const BLOCK_DELETED = BLOCK.define({
  type: namespaced("block.deleted"),
  // 2 for the same reason as `block.edited`: the page came off the payload.
  v: 2,
  parse: (raw): BlockDeleted | undefined => {
    const it = withId(raw);
    return it && { id: it.id };
  },
  // A plain filter, no tombstone, and the subtree goes with it. Every event
  // that built them is still on disk.
  apply: (state, { id }) => (forest.has(state.forest, id) ? withoutTree(state, id) : state),
  undo: {
    // The block and its subtree written back where it was, with the same ids.
    inverse: (state, { id }) => {
      const found = find(state, id);
      const place = placeOf(state, id);
      const block = treeOf(state, id);
      return found && place && block ? recreate(found.page, block, place) : [];
    },
    touched: (state, { id }) => (forest.has(state.forest, id) ? [stillGone(subtreeOf(state, id))] : []),
  },
});

/** The `block.deleted` event: the user is done with `id`. */
export function blockDeleted(id: string): Written<Named<"block.deleted">, BlockDeleted> {
  return BLOCK_DELETED.build({ id });
}
