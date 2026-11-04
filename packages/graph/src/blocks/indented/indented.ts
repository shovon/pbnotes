/**
 * `block.indented`: a block became the last child of another. Everything
 * about the event, from reading its payload to undoing it (#238).
 */
import { namespaced } from "../../events/events.ts";
import type { Named } from "../../events/events.ts";
import type { Written } from "../../over/over.ts";
import { same } from "../../undo/undo.ts";
import {
  BLOCK,
  find,
  locate,
  mapChildren,
  onBlock,
  position,
  stringField,
  withId,
  without,
} from "../blocks.ts";
import type { BlockIndented } from "../blocks.ts";
import { blockOutdented } from "../outdented/outdented.ts";

export const BLOCK_INDENTED = BLOCK.define({
  type: namespaced("block.indented"),
  // 2 for the same reason as `block.edited`: the page came off the payload.
  v: 2,
  parse: (raw): BlockIndented | undefined => {
    const it = withId(raw);
    const parent = it && stringField(it.payload, "parent");
    return it && parent ? { id: it.id, parent } : undefined;
  },
  apply: (state, { id, parent }) =>
    onBlock(state, id, (found) => {
      // A parent on another page would be a move across pages, and there is
      // no such event yet.
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
    }),
  // Not safe to fold twice: a second indent would move it again.
  landed: (state, { id, parent }) => find(state, id)?.parent?.id === parent,
  undo: {
    // A command indents under the sibling above, and coming back out after it
    // is where the block was: it is that sibling's last child, so the outdent
    // takes nothing along. An indent anywhere else, from another writer's
    // log, cannot be undone: no event moves a block to an arbitrary place.
    inverse: (state, { id, parent }) => {
      const found = find(state, id);
      if (!found) return [];
      return found.siblings[found.at - 1]?.id === parent
        ? [blockOutdented({ id, after: parent })]
        : undefined;
    },
    touched: (_, { id }) => [same((now) => position(now, id))],
  },
});

/** The `block.indented` event for a move `indented` resolved. */
export function blockIndented(
  payload: BlockIndented,
): Written<Named<"block.indented">, BlockIndented> {
  return BLOCK_INDENTED.build(payload);
}
