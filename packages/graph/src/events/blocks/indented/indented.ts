/**
 * `block.indented`: a block became the last child of another. Everything
 * about the event, from reading its payload to undoing it (#238).
 */
import { namespaced } from "../../events.ts";
import type { Named } from "../../events.ts";
import type { Written } from "../../../over/over.ts";
import { same } from "../../../undo/undo.ts";
import * as forest from "../../../forest/forest.ts";
import { BLOCK, find, keyOf, position, stringField, withId } from "../../../blocks/blocks.ts";
import type { BlockIndented } from "../../../blocks/blocks.ts";
import { blockOutdented } from "../outdented/outdented.ts";
import { movedBack } from "../moved/moved.ts";

export const BLOCK_INDENTED = BLOCK.define({
  type: namespaced("block.indented"),
  // 2 for the same reason as `block.edited`: the page came off the payload.
  v: 2,
  parse: (raw): BlockIndented | undefined => {
    const it = withId(raw);
    const parent = it && stringField(it.payload, "parent");
    return it && parent ? { id: it.id, parent } : undefined;
  },
  apply: (state, { id, parent }) => {
    const key = keyOf(state, id);
    // A parent on another page would be a move across pages, which is
    // `block.moved`'s to say.
    if (key === undefined || keyOf(state, parent) !== key) return state;
    // Under itself or its own subtree: two machines each indenting one
    // block under the other before they sync writes this (#62).
    if (forest.within(state.forest, parent, id)) return state;
    return { ...state, forest: forest.move(state.forest, id, { under: parent, at: "last" }) };
  },
  // Not safe to fold twice: a second indent would move it again.
  landed: (state, { id, parent }) => find(state, id)?.parent === parent,
  undo: {
    // A command indents under the sibling above, and coming back out after it
    // is where the block was: it is that sibling's last child, so the outdent
    // takes nothing along. An indent anywhere else, from another writer's
    // log, is moved back (#252). The outdent stays for the usual case, since
    // a build from before `block.moved` reads it.
    inverse: (state, { id, parent }) => {
      const found = find(state, id);
      if (!found) return [];
      return found.siblings[found.at - 1] === parent
        ? [blockOutdented({ id, after: parent })]
        : movedBack(state, id);
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
