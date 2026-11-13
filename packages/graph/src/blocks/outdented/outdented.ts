/**
 * `block.outdented`: a block came out a level, to sit directly beneath what
 * it hung under. Everything about the event, from reading its payload to
 * undoing it (#238).
 */
import { namespaced } from "../../event/event.ts";
import type { Named } from "../../event/event.ts";
import type { Written } from "../../event/over.ts";
import { same } from "../../undo/undo.ts";
import * as forest from "../../forest/forest.ts";
import { BLOCK, find, position, stringField, withId } from "../blocks.ts";
import type { BlockOutdented } from "../blocks.ts";
import { blockIndented } from "../indented/indented.ts";

export const BLOCK_OUTDENTED = BLOCK.define({
  type: namespaced("block.outdented"),
  // 2 for the same reason as `block.edited`: the page came off the payload.
  v: 2,
  parse: (raw): BlockOutdented | undefined => {
    const it = withId(raw);
    const after = it && stringField(it.payload, "after");
    return it && after ? { id: it.id, after } : undefined;
  },
  apply: (state, { id, after }) => {
    const found = find(state, id);
    if (!found?.parent) return state;
    // The siblings below it come along as its own children, or they would
    // be stranded above it and the page would read in a different order.
    let next = state.forest;
    for (const sibling of found.siblings.slice(found.at + 1)) {
      next = forest.move(next, sibling, { under: id, at: "last" });
    }
    // Directly beneath `after`, at its depth, when it is on the page and not
    // among what moves: otherwise at the end of the page.
    const fits = forest.node(next, after)?.group === found.key && !forest.within(next, after, id);
    next = forest.move(next, id, fits ? { after } : { group: found.key, at: "last" });
    return { ...state, forest: next };
  },
  // Not safe to fold twice: a second outdent would move it again.
  landed: (state, { id, after }) => {
    const found = find(state, id);
    return found?.siblings[found.at - 1] === after;
  },
  undo: {
    // Back under the old parent as its last child, then each sibling the
    // outdent took along back out after it, last first, so they land in
    // their old order.
    inverse: (state, { id }) => {
      const found = find(state, id);
      if (!found?.parent) return [];
      const along = found.siblings.slice(found.at + 1).reverse();
      return [
        blockIndented({ id, parent: found.parent }),
        ...along.map((sibling) => blockOutdented({ id: sibling, after: id })),
      ];
    },
    touched: (state, { id }) => {
      const found = find(state, id);
      const along = found ? found.siblings.slice(found.at + 1) : [];
      return [id, ...along].map((moved) => same((now) => position(now, moved)));
    },
  },
});

/** The `block.outdented` event for a move `outdented` resolved. */
export function blockOutdented(
  payload: BlockOutdented,
): Written<Named<"block.outdented">, BlockOutdented> {
  return BLOCK_OUTDENTED.build(payload);
}
