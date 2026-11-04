/**
 * `block.outdented`: a block came out a level, to sit directly beneath what
 * it hung under. Everything about the event, from reading its payload to
 * undoing it (#238).
 */
import { namespaced } from "../../events.ts";
import type { Named } from "../../events.ts";
import type { Written } from "../../../over/over.ts";
import { same } from "../../../undo/undo.ts";
import {
  BLOCK,
  beside,
  find,
  mapChildren,
  onBlock,
  position,
  stringField,
  withId,
} from "../../../blocks/blocks.ts";
import type { BlockOutdented } from "../../../blocks/blocks.ts";
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
  apply: (state, { id, after }) =>
    onBlock(state, id, (found) => {
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
    }),
  // Not safe to fold twice: a second outdent would move it again.
  landed: (state, { id, after }) => {
    const found = find(state, id);
    return found?.siblings[found.at - 1]?.id === after;
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
        blockIndented({ id, parent: found.parent.id }),
        ...along.map((sibling) => blockOutdented({ id: sibling.id, after: id })),
      ];
    },
    touched: (state, { id }) => {
      const found = find(state, id);
      const along = found ? found.siblings.slice(found.at + 1).map((it) => it.id) : [];
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
