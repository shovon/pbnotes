/**
 * Pages: what pbnotes events mean. This is where the slices meet: the block
 * fold and the property fold behind one gate, the state they fold, and the
 * one read that needs both. Everything else is re-exported from the slice
 * that owns it.
 *
 * No plumbing, and no import of any: not `@pbnotes/ledger`, and no `node:`
 * module, because the app's renderer bundles this too. A caller hands the
 * commands a view whose `dispatch` writes to its own log.
 */
import { BLOCK_HANDLES, reduce } from "./blocks/blocks.ts";
import type { BlockState, PageEvent } from "./blocks/blocks.ts";
import { named as namedByBlocks } from "./blocks/queries.ts";
import {
  named as namedByProperties,
  PROPERTY_HANDLES,
  reduce as reduceProperties,
} from "./properties/properties.ts";
import type { PropertyEvent, PropertyState } from "./properties/properties.ts";
import { search } from "./search/search.ts";
import { titleOf } from "./titles/titles.ts";

export { canonicalize } from "./canonicalize/canonicalize.ts";
export { NAMESPACE } from "./events/events.ts";
export { DATE_PATTERN, today } from "./journal/journal.ts";
export { titleOf } from "./titles/titles.ts";
export {
  beside,
  blocksOn,
  find,
  indented,
  lastLeaf,
  locate,
  outdented,
  predict,
  reduce,
  without,
} from "./blocks/blocks.ts";
export type {
  Block,
  BlockCreated,
  BlockDeleted,
  BlockEdited,
  BlockIndented,
  BlockOutdented,
  Found,
  Page,
  PageEvent,
} from "./blocks/blocks.ts";
export {
  getPage,
  getPages,
  getPreviews,
  getReferences,
  linking,
  locateBlock,
  searchBlocks,
} from "./blocks/queries.ts";
export type { BlockMatch } from "./blocks/queries.ts";
export {
  getProperties,
  predictProperties,
  propertyRemoved,
  propertySet,
} from "./properties/properties.ts";
export type {
  Property,
  PropertyEvent,
  PropertyRemoved,
  PropertySet,
} from "./properties/properties.ts";
export { removeProperty, renameProperty, setProperty } from "./properties/commands.ts";
export {
  addBlock,
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockOutdented,
  deleteBlock,
  editBlock,
  indentBlock,
  outdentBlock,
} from "./blocks/commands.ts";
export { inCode, read } from "./reading/reading.ts";
export { remarkPlugins, remarkWikilink } from "./wikilink/wikilink.ts";

/**
 * Every page, by `canonicalize`: the blocks on it, its properties, and the
 * first spelling the fold saw for it.
 *
 * `Map` throughout, so a title of `__proto__` is an ordinary key (#62), and
 * it survives the structured clone to the renderer (#146).
 */
export type Pages = BlockState & PropertyState;

/**
 * Event type → the payload `v` this build folds and writes. Public contract
 * with `NAMESPACE`; see the README.
 */
export const HANDLES: Record<PageEvent["type"] | PropertyEvent["type"], number> = {
  ...BLOCK_HANDLES,
  ...PROPERTY_HANDLES,
};

/**
 * The pages fold, for whoever runs it over a ledger: `ledger.onEvent(
 * pagesFold.initial, pagesFold.reduce)`.
 *
 * The gate is here: a type this build does not have, or a `v` newer than it
 * reads, leaves the pages as they were. Behind it, each slice's fold in turn.
 * Each hands back what it was given for an event that is not its own, so the
 * order between them does not matter.
 */
export const pagesFold = {
  reduce: (state: Pages, event: { type: string; v: number; payload: unknown }): Pages =>
    Object.hasOwn(HANDLES, event.type) &&
    event.v <= HANDLES[event.type as keyof typeof HANDLES]
      ? reduceProperties(reduce(state, event), event)
      : state,
  initial: { blocks: new Map(), titles: new Map(), properties: new Map() } as Pages,
};

/**
 * The page titles that contain `query`, ignoring case: prefix matches first,
 * then the rest, each A to Z, at most `limit`. A page is any title something
 * names now: blocks on it, a link to it, a property on it, or a property key.
 * Each is offered once, in the spelling it shows.
 */
export function searchPages(state: Pages, query: string, limit = 10): string[] {
  const titles = [...namedByBlocks(state), ...namedByProperties(state)];
  return search(
    titles.map((title) => titleOf(state, title)),
    query,
    limit,
  );
}

/**
 * What the commands are handed: the pages as they stand, and a `dispatch`
 * for any event this fold reads. A `BlocksView` too, so the block commands
 * take it as it is.
 */
export type PagesView = {
  readonly state: Pages;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: keyof typeof HANDLES, payload: unknown): Promise<unknown>;
};
