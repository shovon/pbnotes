/**
 * The graph: what pbnotes events mean. This is where the slices meet: their
 * folds behind one gate, the state they fold, and the reads that need more
 * than one of them. Everything else is re-exported from the slice
 * that owns it.
 *
 * No plumbing, and no import of any: not `@pbnotes/ledger`, and no `node:`
 * module, because the app's renderer bundles this too. A caller hands the
 * commands a view whose `dispatch` writes to its own log.
 */
import { BLOCK_HANDLES, reads as readsBlocks, reduce } from "./blocks/blocks.ts";
import type { BlockState, PageEvent } from "./blocks/blocks.ts";
import {
  countBlocks,
  countLinks,
  getPage as getPageAt,
  getReferences as getReferencesTo,
  named as namedByBlocks,
} from "./blocks/queries.ts";
import type { Page } from "./blocks/blocks.ts";
import {
  getProperties as getPropertiesOn,
  named as namedByProperties,
} from "./properties/properties.ts";
import type { Property, PropertyState } from "./properties/properties.ts";
import {
  PROPERTY_HANDLES,
  PROPERTY_UNDO,
  reads as readsProperties,
  reduce as reduceProperties,
} from "./properties/slice.ts";
import type { PropertyEvent } from "./properties/slice.ts";
import {
  countTaggedBy,
  getTaggedBy as getTaggedByAt,
  getTags as getTagsOn,
  named as namedByTags,
} from "./tags/tags.ts";
import type { TagState } from "./tags/tags.ts";
import { TAG_HANDLES, TAG_UNDO, reads as readsTags, reduce as reduceTags } from "./tags/slice.ts";
import type { TagEvent } from "./tags/slice.ts";
import { named as namedByAliases } from "./aliases/aliases.ts";
import type { AliasState } from "./aliases/aliases.ts";
import {
  ALIAS_HANDLES,
  ALIAS_UNDO,
  reads as readsAliases,
  reduce as reduceAliases,
} from "./aliases/slice.ts";
import type { AliasEvent } from "./aliases/slice.ts";
import { resolver } from "./resolve/resolve.ts";
import { DATE_PATTERN, namesOf } from "./journal/journal.ts";
import {
  DELETE_HANDLES,
  DELETE_UNDO,
  reads as readsDeletes,
  reduce as reduceDeletes,
} from "./deletes/slice.ts";
import { all, BATCH_HANDLES, unbatch } from "./batch/batch.ts";
import type { BatchEvent, Batched } from "./batch/batch.ts";
import { holds as holdsWith, invert as invertWith } from "./undo/undo.ts";
import type { Step, Undo } from "./undo/undo.ts";
import { admits } from "./over/over.ts";
import { BLOCK_UNDO } from "./blocks/undo.ts";
import type { DeleteState } from "./deletes/deletes.ts";
import type { DeleteEvent } from "./deletes/slice.ts";
import { reduce as reduceEdited } from "./edited/edited.ts";
import type { EditedState } from "./edited/edited.ts";
import { search } from "./search/search.ts";
import { titleOf } from "./titles/titles.ts";
import { canonicalize } from "./canonicalize/canonicalize.ts";

export { canonicalize } from "./canonicalize/canonicalize.ts";
export { NAMESPACE } from "./events/events.ts";
export { batch, each } from "./batch/batch.ts";
export { CANNOT } from "./undo/undo.ts";
export type { Check, Undo } from "./undo/undo.ts";
export type { BatchEvent, Batched } from "./batch/batch.ts";
export { DATE_PATTERN, dateOf, namesOf, today } from "./journal/journal.ts";
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
export { getPages, getPreviews, linking, locateBlock, searchBlocks } from "./blocks/queries.ts";
export type { BlockMatch } from "./blocks/queries.ts";
export { propertySet } from "./properties/set/set.ts";
export { propertyRemoved } from "./properties/removed/removed.ts";
export { predictProperties } from "./properties/slice.ts";
export type { Property, PropertyRemoved, PropertySet } from "./properties/properties.ts";
export type { PropertyEvent } from "./properties/slice.ts";
export { removeProperty, renameProperty, setProperty } from "./properties/commands.ts";
export { tagAdded } from "./tags/added/added.ts";
export { tagRemoved } from "./tags/removed/removed.ts";
export { predictTags } from "./tags/slice.ts";
export { addTag, removeTag } from "./tags/commands.ts";
export type { TagAdded, TagRemoved } from "./tags/tags.ts";
export type { TagEvent } from "./tags/slice.ts";
export { aliasAdded } from "./aliases/added/added.ts";
export { aliasRemoved } from "./aliases/removed/removed.ts";
export type { AliasAdded, AliasRemoved } from "./aliases/aliases.ts";
export type { AliasEvent } from "./aliases/slice.ts";
export { getDeletions, getRefsTo, hasContent } from "./deletes/deletes.ts";
export { deletePage } from "./deletes/commands.ts";
export { pageDeleted } from "./deletes/deleted/deleted.ts";
export type { PageDeleted } from "./deletes/deletes.ts";
export type { DeleteEvent } from "./deletes/slice.ts";
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
 * The graph: every page, by `canonicalize`: the blocks on it, its properties,
 * its tags, its aliases, the first spelling the fold saw for it, how many
 * times it has been deleted, and when it last changed.
 *
 * `Map` throughout, so a title of `__proto__` is an ordinary key (#62), and
 * it survives the structured clone to the renderer (#146).
 */
export type Graph = BlockState &
  PropertyState &
  TagState &
  AliasState &
  DeleteState &
  EditedState;

/**
 * Event type → the payload `v` this build folds and writes. Public contract
 * with `NAMESPACE`; see the README.
 */
export const HANDLES: Record<
  | PageEvent["type"]
  | PropertyEvent["type"]
  | TagEvent["type"]
  | AliasEvent["type"]
  | DeleteEvent["type"]
  | BatchEvent["type"],
  number
> = {
  ...BLOCK_HANDLES,
  ...PROPERTY_HANDLES,
  ...TAG_HANDLES,
  ...ALIAS_HANDLES,
  ...DELETE_HANDLES,
  ...BATCH_HANDLES,
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
 *
 * A batch is its events folded in order at its place, each with the batch's
 * `at`, if every one passes the gate and is well formed for the slice it
 * belongs to. Otherwise none of them is: half of a batch is what it exists
 * to prevent.
 */
export const graphFold = {
  reduce: (state: Graph, event: Incoming): Graph => {
    if (!gated(event)) return state;
    const events = unbatch(event);
    if (!events) return one(state, event);
    const { at } = event;
    return all(state, events.map((it) => ({ ...it, at })), readable, one);
  },
  initial: {
    blocks: new Map(),
    titles: new Map(),
    properties: new Map(),
    tags: new Map(),
    aliases: new Map(),
    deletions: new Map(),
    edited: new Map(),
  } as Graph,
};

// ── Undo (#233) ─────────────────────────────────────────────────────────────

/** What one command wrote: the graph before it, its events, and the graph after. */
export type UndoStep = Step<Graph>;

/**
 * Event type → how to undo it: every slice's entries for the events it owns.
 * Keyed on every type in `HANDLES` but `batch`, which is undone as the events
 * it holds, so an event type with no entry stops the build here. An event
 * that cannot be undone says so in its entry (`CANNOT`).
 */
export const UNDO: Record<Exclude<keyof typeof HANDLES, BatchEvent["type"]>, Undo<Graph>> = {
  ...BLOCK_UNDO,
  ...PROPERTY_UNDO,
  ...TAG_UNDO,
  ...ALIAS_UNDO,
  ...DELETE_UNDO,
};

/**
 * The events that undo `events`, written on `before`, to be written as one
 * `batch`. `[]` when nothing in them changed anything; `undefined` when one
 * that did cannot be undone. See the README.
 */
export function invert(before: Graph, events: readonly Batched[]): Batched[] | undefined {
  return invertWith(graphFold.reduce, UNDO, before, events);
}

/**
 * Whether `step` can still be undone in `now`: everything it touched is as it
 * left it, so undoing it undoes nobody else's work.
 */
export function holds(now: Graph, step: UndoStep): boolean {
  return holdsWith(graphFold.reduce, UNDO, now, step);
}

/** An event as the fold is handed one. */
type Incoming = { type: string; v: number; at?: unknown; payload: unknown };

/** Whether this build has `event`'s type, at a `v` it reads. */
function gated(event: Incoming): boolean {
  return admits(HANDLES, event);
}

/** Through the gate, and well formed for the slice whose type it is. */
function readable(event: Incoming): boolean {
  return (
    gated(event) &&
    [readsBlocks, readsProperties, readsTags, readsAliases, readsDeletes].some((reads) =>
      reads(event),
    )
  );
}

/** One event past the gate: every slice, then when its page changed. */
function one(state: Graph, event: Incoming): Graph {
  return reduceEdited(state, behindTheGate(state, event), event);
}

/** Each slice's fold in turn. The delete fold empties what the others hold. */
function behindTheGate(state: Graph, event: { type: string; payload: unknown }): Graph {
  const slices: ((state: Graph, event: { type: string; payload: unknown }) => Graph)[] = [
    reduce,
    reduceProperties,
    reduceTags,
    reduceAliases,
    reduceDeletes,
  ];
  return slices.reduce((folded, slice) => slice(folded, event), state);
}

/** Every title something names now: blocks, links, properties, tags and aliases. */
function named(state: Graph): string[] {
  return [
    ...namedByBlocks(state),
    ...namedByProperties(state),
    ...namedByTags(state),
    ...namedByAliases(state),
  ];
}

// ── Names: what a name opens (#221) ─────────────────────────────────────────
//
// The slices' own reads take a page's title as written. These go through
// `resolve` first, so a page reached by an alias or a date name is the page
// it opens: its blocks, properties and tags, and what links to it by any of
// its names.

/** What resolving reads. */
type Names = BlockState & PropertyState & TagState & AliasState;

/**
 * The page `title` opens, as it shows: the page that claims it as an alias,
 * the day a date name means, or `title` itself. See the README for the order.
 */
export function resolve(state: Names, title: string): string {
  return resolver(state).title(title);
}

/** The page `title` opens, as it stands. `getPage(graph, "JS")` is `JavaScript`. */
export function getPage(state: Names, title: string): Page {
  return getPageAt(state, resolve(state, title));
}

/**
 * What links to the page `title` opens, by any name that opens it: its
 * title, its date names if it is a day, and its aliases in effect.
 */
export function getReferences(state: Names, title: string): Page[] {
  const names = resolver(state);
  return getReferencesTo(state, names.title(title), names.names(names.key(title)));
}

/** The properties of the page `title` opens. */
export function getProperties(state: Names, title: string): Property[] {
  return getPropertiesOn(state, resolve(state, title));
}

/** The tags of the page `title` opens. */
export function getTags(state: Names, title: string): string[] {
  return getTagsOn(state, resolve(state, title));
}

/** The pages that tag the page `tag` opens, by any name that opens it. */
export function getTaggedBy(state: Names, tag: string): string[] {
  const names = resolver(state);
  return getTaggedByAt(state, names.title(tag), names.names(names.key(tag)));
}

/**
 * The aliases in effect on the page `page` opens, each as it shows, ordered
 * by `canonicalize`. Not a day's built-in names, which are `namesOf`.
 */
export function getAliases(state: Names, page: string): string[] {
  const names = resolver(state);
  return names
    .aliases(names.key(page))
    .sort()
    .map((alias) => titleOf(state, alias));
}

/** The page `alias` opens as an alias in effect, as it shows, or undefined. */
export function getAliasOf(state: Names, alias: string): string | undefined {
  return resolver(state).aliasOf(alias);
}

/** A page title search offered, and the page following it opens. */
export type PageMatch = {
  /** As it shows. What a link to it is written as. */
  title: string;
  /** The page it opens, as it shows: `title` itself unless it resolves elsewhere. */
  opens: string;
};

/**
 * Every name search offers, by key, each in the spelling it shows: every
 * title something names, and each day one of them opens, by its title and
 * its built-in names: a day named by a link to `Nov 4th, 2024` is offered as
 * `2024-11-04` and `November 4th, 2024` too.
 */
function offered(state: Graph): Map<string, string> {
  const opens = resolver(state);
  const names = new Map<string, string>();
  for (const title of named(state)) {
    const key = canonicalize(title);
    if (!names.has(key)) names.set(key, titleOf(state, key));
  }
  const days = new Set([...names.keys()].map(opens.key).filter((key) => DATE_PATTERN.test(key)));
  for (const day of days) {
    if (!names.has(day)) names.set(day, titleOf(state, day));
    for (const name of namesOf(day)) {
      const at = canonicalize(name);
      if (!names.has(at)) names.set(at, titleOf(state, name));
    }
  }
  return names;
}

/**
 * The page titles that contain `query`, ignoring case: prefix matches first,
 * then the rest, each A to Z, at most `limit`, each with the page it opens.
 * A page is any title something names now: blocks on it, a link to it, a
 * property on it, a property key, a tag on it, a tag pointing to it, an
 * alias, or a page with one. A day anything names is offered by its date
 * names too, so `Nov 4` finds `Nov 4th, 2024`. Each is offered once, in the
 * spelling it shows.
 */
export function searchNames(state: Graph, query: string, limit = 10): PageMatch[] {
  const names = resolver(state);
  return search(offered(state).values(), query, limit).map((title) => ({
    title,
    opens: names.title(title),
  }));
}

/** `searchNames`, the titles alone. */
export function searchPages(state: Graph, query: string, limit = 10): string[] {
  return searchNames(state, query, limit).map(({ title }) => title);
}

/** One page as the list of every page shows it. */
export type PageListing = {
  /** In the spelling it shows. */
  title: string;
  /** Blocks on it, at every depth. 0 for a page only a link, a property or a tag names. */
  blocks: number;
  /** Blocks on other pages that link to it by any of its names (`countLinks`). Tags never count here. */
  references: number;
  /** Pages that tag it, by any of its names. */
  taggedBy: number;
  /** When it last changed, in ms since the epoch; undefined if nothing ever did. */
  edited?: number;
};

/**
 * Every page, as `searchPages` counts one, journal days included, each once
 * in the spelling it shows, A to Z. With what is on it, what links to it,
 * what tags it and when it last changed.
 *
 * A name that opens another page (an alias in effect, a date name with no
 * page of its own) is not a row: its links and tags count for the page it
 * opens.
 */
export function listPages(state: Graph): PageListing[] {
  const names = resolver(state);
  const links = countLinks(state, names.key);
  const tagged = countTaggedBy(state, names.key);
  const keys = new Set(named(state).map(names.key));
  return [...keys]
    .map((key) => {
      const edited = state.edited.get(key);
      return {
        title: titleOf(state, key),
        blocks: countBlocks(state, key),
        references: links.get(key) ?? 0,
        taggedBy: tagged.get(key) ?? 0,
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
