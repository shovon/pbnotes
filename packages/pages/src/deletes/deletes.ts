/**
 * Deleting a page: the event, its fold, its builder and the reads around it.
 *
 * Where the block fold and the property fold meet, because a page delete
 * empties both. One event for the whole page, so a crash or a sync still
 * arriving can never leave it half deleted. Nothing leaves the disk: the
 * event records that the user was done with the page.
 *
 * Whether the page still exists afterwards is not stored. A page that only a
 * link names exists while the link does, so a page some other page links to
 * stays in search, empty, until the last link goes.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field, NAMESPACE, unnamed } from "../events/events.ts";
import type { Named } from "../events/events.ts";
import { read } from "../reading/reading.ts";
import { blocksOn } from "../blocks/blocks.ts";
import type { Block, BlockState } from "../blocks/blocks.ts";
import { getReferences } from "../blocks/queries.ts";
import type { PropertyState } from "../properties/properties.ts";

/**
 * How many times each page has been deleted, by `canonicalize`. A window on a
 * page tells a delete from a page that merely went empty by this going up.
 */
export type DeleteState = {
  readonly deletions: Map<string, number>;
};

/** What a delete folds over: the blocks and properties it empties. */
type Holds = BlockState & PropertyState & DeleteState;

// ── The event ───────────────────────────────────────────────────────────────

/** That the user was done with `page`: its blocks and its properties. */
export type PageDeleted = { page: string };

export type DeleteEvent = { type: Named<"page.deleted">; payload: PageDeleted };

/**
 * Event type → the payload `v` this build folds and writes. The delete part
 * of `HANDLES`; the gate that reads it is `pagesFold`.
 */
export const DELETE_HANDLES: Record<DeleteEvent["type"], number> = {
  [`${NAMESPACE}page.deleted`]: 1,
};

/** The `page.deleted` event: `page` and everything on it are done with. */
export function pageDeleted(page: string): DeleteEvent & { v: number } {
  const type = `${NAMESPACE}page.deleted` as const;
  return { v: DELETE_HANDLES[type], type, payload: { page } };
}

// ── The fold ────────────────────────────────────────────────────────────────

/**
 * The page a delete names, or undefined for anything that is not a
 * well-formed `page.deleted`. A page has to be something once trimmed, as a
 * property's does.
 */
function parse(event: { type: string; payload: unknown }): string | undefined {
  if (unnamed(event.type) !== "page.deleted") return undefined;
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = field(payload, "page");
  return typeof page === "string" && page.trim() !== "" ? page : undefined;
}

/**
 * The delete fold: the page's blocks and properties emptied at its key, as
 * the page stands at this point in fold order. A block or property written
 * after it in fold order is a later fact, and stands.
 *
 * `titles` is left alone, so a page a link keeps alive still shows the
 * spelling it had. Hands back `state` itself for any other event.
 */
export function reduce<S extends Holds>(
  state: S,
  event: { type: string; payload: unknown },
): S {
  const page = parse(event);
  if (page === undefined) return state;
  const key = canonicalize(page);
  const blocks = new Map(state.blocks);
  blocks.delete(key);
  const properties = new Map(state.properties);
  properties.delete(key);
  const deletions = new Map(state.deletions).set(key, (state.deletions.get(key) ?? 0) + 1);
  return { ...state, blocks, properties, deletions };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** How many times `page` has been deleted. 0 for one never deleted. */
export function getDeletions(state: DeleteState, page: string): number {
  return state.deletions.get(canonicalize(page)) ?? 0;
}

/** Whether a delete of `page` would change anything: something is on it. */
export function hasContent(state: BlockState & PropertyState, page: string): boolean {
  const key = canonicalize(page);
  return (state.blocks.get(key)?.length ?? 0) > 0 || (state.properties.get(key)?.size ?? 0) > 0;
}

/** What deleting a page leaves pointing at it, counted in blocks on other pages. */
export type DeleteImpact = {
  /** Blocks that link to the page by title. They keep it alive, empty. */
  links: number;
  /** Blocks that hold a `((id))` to a block on the page. Those show as missing. */
  refs: number;
};

/** Every block in a tree, depth first. */
function* every(blocks: Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    yield* every(block.children);
  }
}

/**
 * What a delete of `page` would leave behind on other pages. A block that
 * links is counted once with its subtree, as the page's references list it.
 * Nothing on the page itself counts: it goes with the delete.
 */
export function getDeleteImpact(state: BlockState, page: string): DeleteImpact {
  const links = getReferences(state, page).reduce((sum, it) => sum + it.blocks.length, 0);
  const on = new Set([...every(blocksOn(state, page))].map((block) => block.id));
  const key = canonicalize(page);
  let refs = 0;
  for (const [other, blocks] of state.blocks) {
    if (other === key) continue;
    for (const block of every(blocks)) {
      if (read(block.text).refs.some((id) => on.has(id))) refs++;
    }
  }
  return { links, refs };
}

// ── The command ─────────────────────────────────────────────────────────────

/**
 * What `deletePage` needs: the state as it stands, and a way to append the
 * event. `PagesView` is one.
 */
export type DeletesView = {
  readonly state: BlockState & PropertyState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: DeleteEvent["type"], payload: unknown): Promise<unknown>;
};

/**
 * Deletes `page`'s blocks and properties, as one event. A page with nothing
 * on it writes nothing: the delete would change nothing, and the log does not
 * collect events that mean nothing.
 */
export async function deletePage(view: DeletesView, page: string): Promise<void> {
  if (!hasContent(view.state, page)) return;
  const event = pageDeleted(page);
  await view.dispatch(event.v, event.type, event.payload);
}
