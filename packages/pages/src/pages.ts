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
import { BLOCK_HANDLES, find, reduce, removedBy } from "./blocks/blocks.ts";
import type { Block, BlockState, PageEvent, Page } from "./blocks/blocks.ts";
import { DATE_PATTERN } from "./journal/journal.ts";
import {
  foldProperty,
  forget,
  parseProperty,
  PROPERTY_HANDLES,
} from "./properties/properties.ts";
import type { Properties, PropertyEvent, Target } from "./properties/properties.ts";
import * as propertyCommands from "./properties/commands.ts";
import type { PropertiesView } from "./properties/commands.ts";

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
  propertyItemAdded,
  propertyItemRemoved,
  propertyRemoved,
  propertySet,
  propertyUnset,
} from "./properties/commands.ts";
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
  Entries,
  Entry,
  Kind,
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
  Target,
} from "./properties/properties.ts";
export { remarkPlugins, remarkWikilink } from "./wikilink/wikilink.ts";

/**
 * Every page, by `canonicalize`: the blocks on it, the first spelling the
 * fold saw for it, and the properties of every page and block. Properties sit
 * beside the blocks, not inside them, so nothing that reads blocks changes
 * (#84). Every key in `blocks`, and every page in `properties`, is in
 * `titles`; every block in `properties` is in `blocks`.
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
 * Whether the fold has `of` to hang properties on. A page is named into
 * being, so it always is; a block is there once created and until deleted.
 */
function exists(state: Pages, of: Target): boolean {
  switch (of.kind) {
    case "page":
      return true;
    case "block":
      return find(state, of.id) !== undefined;
  }
}

/**
 * One event through both folds, and the rules that need both (#155):
 *
 * - A property of a block the fold lacks is dropped, as an edit to it is.
 *   The ledger folds in clock order, so a writer that saw the block sorts
 *   after it; only a clock skewed past `MAX_CLOCK_SKEW_MS` loses a write.
 * - A deleted block takes its properties, and its subtree's, with it.
 *   Nothing is kept in memory for an undelete; the log still has it all.
 */
function reducePages(state: Pages, event: { type: string; payload: unknown }): Pages {
  const property = parseProperty(event);
  if (property) return exists(state, property.of) ? foldProperty(state, property) : state;

  const gone = removedBy(state, event);
  const next = reduce(state, event);
  if (gone.length === 0) return next;
  const properties = forget(
    next.properties,
    gone.map((id): Target => ({ kind: "block", id })),
  );
  return properties === next.properties ? next : { ...next, properties };
}

/**
 * The pages fold, for whoever runs it over a ledger: `ledger.onEvent(
 * pagesFold.initial, pagesFold.reduce)`.
 *
 * The gate is here: a type this build does not have, or a `v` newer than it
 * reads, leaves the pages as they were. Behind it, `reducePages`.
 */
export const pagesFold = {
  reduce: (state: Pages, event: { type: string; v: number; payload: unknown }): Pages =>
    Object.hasOwn(HANDLES, event.type) &&
    event.v <= HANDLES[event.type as keyof typeof HANDLES]
      ? reducePages(state, event)
      : state,
  initial: { blocks: new Map(), titles: new Map(), properties: new Map() } as Pages,
};

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

/**
 * `view` as the property commands see it, with `exists` from both folds.
 * State is read through, so a command that writes several events sees each
 * one land.
 */
function propertiesOf(view: PagesView): PropertiesView {
  return {
    get state() {
      return view.state;
    },
    exists: (of) => exists(view.state, of),
    dispatch: (v, type, payload) => view.dispatch(v, type, payload),
  };
}

/** A property command that takes a `PagesView`, as the block commands do. */
const onPages =
  <A extends unknown[]>(command: (view: PropertiesView, ...args: A) => Promise<void>) =>
  (view: PagesView, ...args: A): Promise<void> =>
    command(propertiesOf(view), ...args);

/**
 * The property commands (#133), with a block target checked against the
 * block fold. Each refuses what the fold would skip and writes nothing when
 * it would change nothing; see `properties/commands.ts`.
 */
export const setProperty = onPages(propertyCommands.setProperty);
export const unsetProperty = onPages(propertyCommands.unsetProperty);
export const addPropertyItem = onPages(propertyCommands.addPropertyItem);
export const removePropertyItem = onPages(propertyCommands.removePropertyItem);
export const removeProperty = onPages(propertyCommands.removeProperty);
export const renameProperty = onPages(propertyCommands.renameProperty);

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
    ...(properties.get("page")?.keys() ?? []),
  ]);
  return [...days]
    .filter((key) => DATE_PATTERN.test(key))
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ title: titles.get(key) ?? key, blocks: on(key) }));
}
