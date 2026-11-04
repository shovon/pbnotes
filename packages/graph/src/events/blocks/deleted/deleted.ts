/**
 * `block.deleted`: the user was done with a block and its subtree.
 * Everything about the event, from reading its payload to undoing it (#238).
 */
import { namespaced } from "../../events.ts";
import type { Named } from "../../events.ts";
import type { Written } from "../../../over/over.ts";
import { BLOCK, find, ids, onBlock, placeOf, stillGone, withId, without } from "../../../blocks/blocks.ts";
import type { BlockDeleted } from "../../../blocks/blocks.ts";
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
  apply: (state, { id }) => onBlock(state, id, ({ blocks }) => without(blocks, id)),
  undo: {
    // The block and its subtree written back where it was, with the same ids.
    inverse: (state, { id }) => {
      const found = find(state, id);
      const place = placeOf(state, id);
      return found && place ? recreate(found.page, found.siblings[found.at], place) : [];
    },
    touched: (state, { id }) => {
      const found = find(state, id);
      return found ? [stillGone(ids([found.siblings[found.at]]))] : [];
    },
  },
});

/** The `block.deleted` event: the user is done with `id`. */
export function blockDeleted(id: string): Written<Named<"block.deleted">, BlockDeleted> {
  return BLOCK_DELETED.build({ id });
}
