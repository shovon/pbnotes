/**
 * The graph: what pbnotes events mean. This is where the slices meet: the block
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
import { countBlocks, countLinks, named as namedByBlocks } from "./blocks/queries.ts";
import {
  named as namedByProperties,
  PROPERTY_HANDLES,
  reduce as reduceProperties,
} from "./properties/properties.ts";
import type { PropertyEvent, PropertyState } from "./properties/properties.ts";
import { DELETE_HANDLES, reduce as reduceDeletes } from "./deletes/deletes.ts";
import type { DeleteEvent, DeleteState } from "./deletes/deletes.ts";
import { reduce as reduceEdited } from "./edited/edited.ts";
import type { EditedState } from "./edited/edited.ts";
import { search } from "./search/search.ts";
import { titleOf } from "./titles/titles.ts";
import { canonicalize } from "./canonicalize/canonicalize.ts";

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
  deletePage,
  getDeletions,
  getRefsTo,
  hasContent,
  pageDeleted,
} from "./deletes/deletes.ts";
export type { DeleteEvent, PageDeleted } from "./deletes/deletes.ts";
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
export { getEdited } from "./edited/edited.ts";
export { countBlocks, countLinks } from "./blocks/queries.ts";
export { inCode, read } from "./reading/reading.ts";
export { remarkPlugins, remarkWikilink } from "./wikilink/wikilink.ts";

/**
 * The graph: every page, by `canonicalize`: the blocks on it, its properties, the first
 * spelling the fold saw for it, how many times it has been deleted, and when
 * it last changed.
 *
 * `Map` throughout, so a title of `__proto__` is an ordinary key (#62), and
 * it survives the structured clone to the renderer (#146).
 */
export type Graph = BlockState & PropertyState & DeleteState & EditedState;

/**
 * Event type → the payload `v` this build folds and writes. Public contract
 * with `NAMESPACE`; see the README.
 */
export const HANDLES: Record<
  PageEvent["type"] | PropertyEvent["type"] | DeleteEvent["type"],
  number
> = {
  ...BLOCK_HANDLES,
  ...PROPERTY_HANDLES,
  ...DELETE_HANDLES,
};

/**
 * The graph fold, for whoever runs it over a ledger: `ledger.onEvent(
 * graphFold.initial, graphFold.reduce)`.
 *
 * The gate is here: a type this build does not have, or a `v` newer than it
 * reads, leaves the graph as it was. Behind it, each slice's fold in turn.
 * Each hands back what it was given for an event that is not its own, so the
 * order between them does not matter. Last, when each page changed, read off
 * what the others did with the event.
 */
export const graphFold = {
  reduce: (
    state: Graph,
    event: { type: string; v: number; at?: unknown; payload: unknown },
  ): Graph =>
    Object.hasOwn(HANDLES, event.type) &&
    event.v <= HANDLES[event.type as keyof typeof HANDLES]
      ? reduceEdited(state, reduceDeletes(reduceProperties(reduce(state, event), event), event), event)
      : state,
  initial: {
    blocks: new Map(),
    titles: new Map(),
    properties: new Map(),
    deletions: new Map(),
    edited: new Map(),
  } as Graph,
};

/**
 * The page titles that contain `query`, ignoring case: prefix matches first,
 * then the rest, each A to Z, at most `limit`. A page is any title something
 * names now: blocks on it, a link to it, a property on it, or a property key.
 * Each is offered once, in the spelling it shows.
 */
export function searchPages(state: Graph, query: string, limit = 10): string[] {
  const titles = [...namedByBlocks(state), ...namedByProperties(state)];
  return search(
    titles.map((title) => titleOf(state, title)),
    query,
    limit,
  );
}

/** One page as the list of every page shows it. */
export type PageListing = {
  /** In the spelling it shows. */
  title: string;
  /** Blocks on it, at every depth. 0 for a page only a link or a property names. */
  blocks: number;
  /** Blocks on other pages that link to it by title (`countLinks`). */
  references: number;
  /** When it last changed, in ms since the epoch; undefined if nothing ever did. */
  edited?: number;
};

/**
 * Every page, as `searchPages` counts one, journal days included, each once
 * in the spelling it shows, A to Z. With what is on it, what links to it and
 * when it last changed.
 */
export function listPages(state: Graph): PageListing[] {
  const links = countLinks(state);
  const keys = new Set([...namedByBlocks(state), ...namedByProperties(state)].map(canonicalize));
  return [...keys]
    .map((key) => {
      const edited = state.edited.get(key);
      return {
        title: titleOf(state, key),
        blocks: countBlocks(state, key),
        references: links.get(key) ?? 0,
        ...(edited === undefined ? {} : { edited }),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * What the commands are handed: the graph as it stands, and a `dispatch`
 * for any event this fold reads. A `BlocksView` too, so the block commands
 * take it as it is.
 */
export type GraphView = {
  readonly state: Graph;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: keyof typeof HANDLES, payload: unknown): Promise<unknown>;
};
