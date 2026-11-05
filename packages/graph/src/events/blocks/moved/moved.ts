/**
 * `block.moved`: a block, with everything under it, went to another place in
 * the graph, on its own page or another (#252). Everything about the event,
 * from reading its payload to undoing it (#238).
 */
import { canonicalize } from "../../../canonicalize/canonicalize.ts";
import { field, namespaced } from "../../events.ts";
import type { Named } from "../../events.ts";
import type { Written } from "../../../over/over.ts";
import { spell } from "../../../titles/titles.ts";
import { same } from "../../../undo/undo.ts";
import {
  BLOCK,
  blocksOn,
  find,
  ids,
  placeOf,
  placedAt,
  position,
  sitsAt,
  stringField,
  withId,
  without,
} from "../../../blocks/blocks.ts";
import type { BlockMoved, BlockState } from "../../../blocks/blocks.ts";

export const BLOCK_MOVED = BLOCK.define({
  type: namespaced("block.moved"),
  v: 1,
  /**
   * A page is required, and is a string: a move with nowhere to go means
   * nothing. The place fields are read as `block.created` reads them: one
   * that is not a non-empty string is as if it were absent, as is a `first`
   * that is anything but `true`.
   */
  parse: (raw): BlockMoved | undefined => {
    const it = withId(raw);
    const page = it && stringField(it.payload, "page");
    if (!it || page === undefined) return undefined;
    const after = stringField(it.payload, "after");
    const parent = stringField(it.payload, "parent");
    const first = field(it.payload, "first") === true;
    return {
      id: it.id,
      page,
      ...(after ? { after } : {}),
      ...(parent ? { parent } : {}),
      ...(first ? { first } : {}),
    };
  },
  apply: (state, it) => moved(state, it) ?? state,
  // Not safe to fold twice: the place may name the block's old neighbours.
  landed: (state, { id, page, ...place }) => sitsAt(state, id, page, place),
  undo: {
    // Back where it was: its page, its parent, and the sibling above it.
    // Always possible while the block is there.
    inverse: (state, { id }) => movedBack(state, id),
    // Its subtree goes back with it, so only where it sits has to hold.
    touched: (_, { id }) => [same((now) => position(now, id))],
  },
});

/**
 * The graph with the block moved, or undefined when the move changes nothing:
 * a block the graph lacks, one already where the move puts it, a place inside
 * its own subtree (two writers each moving one block under the other before
 * they sync write this, #62), or a place the target page lacks. That last is
 * a log written against another graph, and the block stays where its owner
 * last saw it.
 */
function moved<S extends BlockState>(state: S, it: BlockMoved): S | undefined {
  const { id, page, ...place } = it;
  const found = find(state, id);
  if (!found || sitsAt(state, id, page, place)) return undefined;
  // Read before the detach, so the whole subtree moves.
  const moving = found.siblings[found.at];
  const inside = new Set(ids([moving]));
  if ((place.after && inside.has(place.after)) || (place.parent && inside.has(place.parent))) {
    return undefined;
  }
  const blocks = new Map(state.blocks).set(canonicalize(found.page), without(found.blocks, id));
  const next = placedAt(blocksOn({ blocks }, page), moving, place);
  if (!next) return undefined;
  return {
    ...state,
    blocks: blocks.set(canonicalize(page), next),
    // A page nothing was written on yet is spelled as the move wrote it.
    titles: spell(state.titles, [page]),
  };
}

/**
 * The `block.moved` that puts the block `id` back where it sits in `state`,
 * as `[]` when the block is not there. What undoes any move of a block.
 */
export function movedBack(state: BlockState, id: string): Written<Named<"block.moved">, BlockMoved>[] {
  const found = find(state, id);
  const place = placeOf(state, id);
  return found && place ? [blockMoved({ id, page: found.page, ...place })] : [];
}

/**
 * The `block.moved` event: the same bytes `moveBlock` writes. An absent
 * `after` or `parent`, and a `first` that is not `true`, is left off.
 */
export function blockMoved(payload: BlockMoved): Written<Named<"block.moved">, BlockMoved> {
  const { id, page, after, parent, first } = payload;
  return BLOCK_MOVED.build({
    id,
    page,
    ...(after ? { after } : {}),
    ...(parent ? { parent } : {}),
    ...(first ? { first: true as const } : {}),
  });
}
