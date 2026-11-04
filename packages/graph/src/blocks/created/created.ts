/**
 * `block.created`: where the user wrote a block. Everything about the event,
 * from reading its payload to undoing it (#238), and how a block and its
 * subtree are written back, which undoing a delete of either kind uses.
 */
import { canonicalize } from "../../canonicalize/canonicalize.ts";
import { field, namespaced } from "../../events/events.ts";
import type { Named } from "../../events/events.ts";
import type { Batched } from "../../batch/batch.ts";
import type { Written } from "../../over/over.ts";
import { read } from "../../reading/reading.ts";
import { spell } from "../../titles/titles.ts";
import { same } from "../../undo/undo.ts";
import { BLOCK, blocksOn, find, placed, position, stringField, tree, withId } from "../blocks.ts";
import type { Block, BlockCreated, Place } from "../blocks.ts";
import { blockDeleted } from "../deleted/deleted.ts";

export const BLOCK_CREATED = BLOCK.define({
  type: namespaced("block.created"),
  // Still 1 with `parent` (#226) and `first` (#231): an older build ignores
  // either field and shows the block at the end of the page. At 2 it would
  // skip the block, and every later edit to it, entirely.
  v: 1,
  /**
   * Two leniencies, both so that a block is never dropped that could be
   * shown: a page that is not a string is filed under its `String` (it always
   * was), and an `after` or `parent` that is not a non-empty string is as if
   * it were absent, as is a `first` that is anything but `true`.
   */
  parse: (raw): BlockCreated | undefined => {
    const it = withId(raw);
    const text = it && stringField(it.payload, "text");
    if (!it || text === undefined) return undefined;
    const after = stringField(it.payload, "after");
    const parent = stringField(it.payload, "parent");
    const first = field(it.payload, "first") === true;
    return {
      page: String(field(it.payload, "page")),
      id: it.id,
      text,
      ...(after ? { after } : {}),
      ...(parent ? { parent } : {}),
      ...(first ? { first } : {}),
    };
  },
  apply: (state, it) => {
    const { page, id, text } = it;
    const block: Block = { id, text, children: [] };
    // `addBlock` refuses an `after` or `parent` the page lacks, so a miss
    // here is a log written by something else. Fall back rather than drop:
    // a block in the wrong place can be moved, one the fold discarded is gone.
    const next = placed(blocksOn(state, page), block, it);
    return {
      ...state,
      blocks: new Map(state.blocks).set(canonicalize(page), next),
      // The page before its links: it is where the user was writing.
      titles: spell(state.titles, [page, ...read(text).links]),
    };
  },
  // Not safe to fold twice: a second creation would show the block twice.
  landed: (state, { id }) => !!find(state, id),
  undo: {
    inverse: (state, { id }) => (find(state, id) ? [] : [blockDeleted(id)]),
    // Undone, it goes with its subtree: nobody may have written under it.
    touched: (_, { id }) => [same((now) => tree(now, id)), same((now) => position(now, id))],
  },
});

/**
 * The `block.created` event: the same bytes `addBlock` writes. A writer with
 * no fold (the CLI) can write a valid one if it trusts its own `after`,
 * `parent` and `id`. An absent `after` or `parent`, and a `first` that is not
 * `true`, is left off, so a block written without one writes the bytes it
 * always did.
 */
export function blockCreated(
  page: string,
  text: string,
  after: string | undefined,
  id: string,
  parent?: string,
  first?: boolean,
): Written<Named<"block.created">, BlockCreated> {
  return BLOCK_CREATED.build({
    page,
    id,
    text,
    ...(after ? { after } : {}),
    ...(parent ? { parent } : {}),
    ...(first ? { first: true as const } : {}),
  });
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
