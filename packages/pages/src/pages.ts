/**
 * Pages: what pbnotes events mean. This is where the slices meet — the block
 * fold and the property fold composed behind one gate, the state they share,
 * and the one read that needs both. Everything else is re-exported from the
 * slice that owns it.
 *
 * No plumbing, and no import of any: not `@pbnotes/ledger`, and no `node:`
 * module, because the app's renderer bundles this too. A caller hands the
 * commands a view whose `dispatch` writes to its own log.
 *
 * What several machines writing at once does to a page is
 * `app/docs/block-sync.md`.
 */
import { BLOCK_HANDLES, reduce } from "./blocks/blocks.ts";
import type { Block, BlockState, PageEvent, Page } from "./blocks/blocks.ts";
import type { BlocksView } from "./blocks/commands.ts";
import { DATE_PATTERN } from "./journal/journal.ts";
import { PROPERTY_HANDLES, reduceProperties } from "./properties/properties.ts";
import type { Properties, PropertyEvent } from "./properties/properties.ts";

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
  getPreviews,
  getReferences,
  linking,
  locateBlock,
  searchPages,
} from "./blocks/queries.ts";
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
export {
  children,
  get,
  getItems,
  getValue,
  list,
  path,
  showPath,
} from "./properties/properties.ts";
export type {
  Entry,
  Properties,
  Property,
  PropertyEvent,
  PropertyItemAdded,
  PropertyItemRemoved,
  PropertyRemoved,
  PropertySet,
  PropertyUnset,
  Scalar,
  Seen,
} from "./properties/properties.ts";
export { remarkPlugins, remarkWikilink } from "./wikilink/wikilink.ts";

/**
 * Every page, by `canonicalize`: the blocks on it, the first spelling the
 * fold saw for it, and its properties. Properties sit beside the blocks, not
 * inside them, so nothing that reads blocks changes (#84). Every key in
 * `blocks` or `properties` is in `titles`.
 *
 * `Map` throughout, so a title of `__proto__` is an ordinary key (#62), and
 * it survives the structured clone to the renderer (#146).
 */
export type Pages = BlockState & { readonly properties: Properties };

/**
 * Event type → the payload `v` this build folds and writes, for both folds in
 * one table, because the gate reads one. Public contract with `NAMESPACE`;
 * see the README.
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
 * reads, leaves the pages as they were. Behind it, the block fold then the
 * property fold; each hands back the state it was given for an event that is
 * not its own, so composing them is all it takes.
 */
export const pagesFold = {
  reduce: (state: Pages, event: { type: string; v: number; payload: unknown }): Pages =>
    Object.hasOwn(HANDLES, event.type) &&
    event.v <= HANDLES[event.type as keyof typeof HANDLES]
      ? reduceProperties(reduce(state, event), event)
      : state,
  initial: { blocks: new Map(), titles: new Map(), properties: new Map() } as Pages,
};

/** What the commands are handed: the pages as they stand, and a `dispatch`. */
export type PagesView = BlocksView & { readonly state: Pages };

/**
 * The journal: every day that has something on it, newest first. A day whose
 * only block was deleted is left out; a day with properties and no blocks is
 * still a day (#84). Today is not added: which day that is depends on the
 * clock, and a caller that shows a journal puts it at the top itself.
 *
 * Here, not in a slice, because it is the one read that needs blocks and
 * properties both.
 */
export function getPages(pages: Pages): Page[] {
  const { blocks, titles, properties } = pages;
  const on = (key: string): Block[] => blocks.get(key) ?? [];
  const days = new Set([
    ...[...blocks.keys()].filter((key) => on(key).length > 0),
    ...properties.keys(),
  ]);
  return [...days]
    .filter((key) => DATE_PATTERN.test(key))
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ title: titles.get(key) ?? key, blocks: on(key) }));
}
