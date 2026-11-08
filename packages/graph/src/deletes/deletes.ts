/**
 * Deleting a page: the state a delete keeps, and the reads around it. The
 * event is in `events/pages/`, and the command is `commands.ts` (#238).
 *
 * Where the block, property, tag, alias and icon folds meet, because a page
 * delete empties all five. One event for the whole page, so a crash or a sync still
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
import * as forest from "../forest/forest.ts";
import * as map from "../immutable/immutable.ts";
import type { ImmutableMap } from "../immutable/immutable.ts";
import type { BlockState } from "../blocks/blocks.ts";
import type { PropertyState } from "../properties/properties.ts";
import type { TagState } from "../tags/tags.ts";
import type { AliasState } from "../aliases/aliases.ts";
import type { IconState } from "../icons/icons.ts";

/**
 * How many times each page has been deleted, by `canonicalize`. A window on a
 * page tells a delete from a page that merely went empty by this going up.
 */
export type DeleteState = {
  readonly deletions: ImmutableMap<number>;
};

/** What a delete folds over: the blocks, properties, tags, aliases and icon it empties. */
export type Holds = BlockState & PropertyState & TagState & AliasState & IconState & DeleteState;

/** `define` and `slice` for the delete event. */
export const DELETE = over<Holds>();

/** That the user was done with `page`: its blocks, its properties, its tags and its icon. */
export type PageDeleted = { page: string };



// ── Reads ───────────────────────────────────────────────────────────────────

/** How many times `page` has been deleted. 0 for one never deleted. */
export function getDeletions(state: DeleteState, page: string): number {
  return map.get(state.deletions, canonicalize(page)) ?? 0;
}

/** Whether a delete of `page` would change anything: something is on it. */
export function hasContent(
  state: BlockState & PropertyState & TagState & AliasState & IconState,
  page: string,
): boolean {
  const key = canonicalize(page);
  return (
    forest.rootsOf(state.forest, key).length > 0 ||
    (map.get(state.properties, key)?.size ?? 0) > 0 ||
    (map.get(state.tags, key)?.size ?? 0) > 0 ||
    (map.get(state.aliases, key)?.size ?? 0) > 0 ||
    map.has(state.icons, key)
  );
}

/** Every block in a tree, depth first. */
export function getRefsTo(state: BlockState, page: string): number {
  const key = canonicalize(page);
  const on = new Set(forest.inGroup(state.forest, key));
  if (on.size === 0) return 0;
  let refs = 0;
  for (const [id, text] of map.entries(state.texts)) {
    if (on.has(id)) continue;
    if (read(text).refs.some((ref) => on.has(ref))) refs++;
  }
  return refs;
}
