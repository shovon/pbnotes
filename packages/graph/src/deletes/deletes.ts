/**
 * Deleting a page: the state a delete keeps, and the reads around it. The
 * event is in `events/pages/`, and the command is `commands.ts` (#238).
 *
 * Where the block, property, tag and alias folds meet, because a page delete
 * empties all four. One event for the whole page, so a crash or a sync still
 * arriving can never leave it half deleted. Nothing leaves the disk: the
 * event records that the user was done with the page.
 *
 * Whether the page still exists afterwards is not stored. A page that only a
 * link names exists while the link does, so a page some other page links to
 * stays in search, empty, until the last link goes.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { over } from "../over/over.ts";
import { read } from "../reading/reading.ts";
import { blocksOn } from "../blocks/blocks.ts";
import type { Block, BlockState } from "../blocks/blocks.ts";
import type { PropertyState } from "../properties/properties.ts";
import type { TagState } from "../tags/tags.ts";
import type { AliasState } from "../aliases/aliases.ts";

/**
 * How many times each page has been deleted, by `canonicalize`. A window on a
 * page tells a delete from a page that merely went empty by this going up.
 */
export type DeleteState = {
  readonly deletions: Map<string, number>;
};

/** What a delete folds over: the blocks, properties, tags and aliases it empties. */
export type Holds = BlockState & PropertyState & TagState & AliasState & DeleteState;

/** `define` and `slice` for the delete event. */
export const DELETE = over<Holds>();

/** That the user was done with `page`: its blocks, its properties and its tags. */
export type PageDeleted = { page: string };



// ── Reads ───────────────────────────────────────────────────────────────────

/** How many times `page` has been deleted. 0 for one never deleted. */
export function getDeletions(state: DeleteState, page: string): number {
  return state.deletions.get(canonicalize(page)) ?? 0;
}

/** Whether a delete of `page` would change anything: something is on it. */
export function hasContent(
  state: BlockState & PropertyState & TagState & AliasState,
  page: string,
): boolean {
  const key = canonicalize(page);
  return (
    (state.blocks.get(key)?.length ?? 0) > 0 ||
    (state.properties.get(key)?.size ?? 0) > 0 ||
    (state.tags.get(key)?.size ?? 0) > 0 ||
    (state.aliases.get(key)?.size ?? 0) > 0
  );
}

/** Every block in a tree, depth first. */
function* every(blocks: Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    yield* every(block.children);
  }
}

/**
 * How many blocks on other pages hold a `((id))` to a block on `page`: what
 * a delete would leave showing as missing. Refs on the page itself go with
 * it, so they do not count. What links to the page by title is
 * `getReferences`.
 *
 * ponytail: walks every block per call, with `read` memoised. Ask it for one
 * page at a time.
 */
export function getRefsTo(state: BlockState, page: string): number {
  const on = new Set([...every(blocksOn(state, page))].map((block) => block.id));
  if (on.size === 0) return 0;
  const key = canonicalize(page);
  let refs = 0;
  for (const [other, blocks] of state.blocks) {
    if (other === key) continue;
    for (const block of every(blocks)) {
      if (read(block.text).refs.some((id) => on.has(id))) refs++;
    }
  }
  return refs;
}
