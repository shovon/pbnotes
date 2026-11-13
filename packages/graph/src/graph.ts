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
import { noBlocks } from "./blocks/blocks.ts";
import type { BlockState } from "./blocks/blocks.ts";
import { BLOCK_HANDLES, BLOCK_UNDO, reads as readsBlocks, reduce } from "./blocks/slice.ts";
import type { PageEvent } from "./blocks/slice.ts";
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
import { iconOf, named as namedByIcons } from "./icons/icons.ts";
import type { IconState } from "./icons/icons.ts";
import { ICON_HANDLES, ICON_UNDO, reads as readsIcons, reduce as reduceIcons } from "./icons/slice.ts";
import type { IconEvent } from "./icons/slice.ts";
import { resolver } from "./resolve/resolve.ts";
import { aliasing, getHeldAliases as heldAliases } from "./resolve/effect/effect.ts";
import type { HeldAlias, Inert } from "./resolve/effect/effect.ts";
import { DATE_PATTERN, namesOf } from "./journal/journal.ts";
import {
  PAGE_HANDLES,
  PAGE_UNDO,
  reads as readsDeletes,
  reduce as reduceDeletes,
} from "./pages/slice.ts";
import { all, BATCH_HANDLES, unbatch } from "./batch/batch.ts";
import type { BatchEvent, Batched } from "./batch/batch.ts";
import { holds as holdsWith, invert as invertWith, remember as rememberWith } from "./undo/undo.ts";
import type { Remembered as RememberedWith, Undo } from "./undo/undo.ts";
import { admits } from "./event/over.ts";
import type { DeleteState } from "./pages/delete.ts";
import { redirect, renamedAway, renamedTo } from "./pages/rename.ts";
import type { RenameState, Renamed } from "./pages/rename.ts";
import { field, unnamed } from "./event/event.ts";
import type { PagesEvent } from "./pages/slice.ts";
import { reduce as reduceEdited } from "./edited/edited.ts";
import type { EditedState } from "./edited/edited.ts";
import { search } from "./search/search.ts";
import { titleOf } from "./titles/titles.ts";
import { canonicalize } from "./titles/canonicalize.ts";
import { empty as emptyMap, get as getKey } from "./immutable/immutable.ts";

export { canonicalize } from "./titles/canonicalize.ts";
export { NAMESPACE } from "./event/event.ts";
export { batch, each } from "./batch/batch.ts";
export { CANNOT } from "./undo/undo.ts";
export type { Check, Undo } from "./undo/undo.ts";
export type { BatchEvent, Batched } from "./batch/batch.ts";
export { DATE_PATTERN, dateOf, namesOf, today } from "./journal/journal.ts";
export { titleOf } from "./titles/titles.ts";
export { blocksOn, find } from "./blocks/blocks.ts";
export { beside, indented, lastLeaf, locate, outdented, without } from "./blocks/tree.ts";
export { predict, reduce } from "./blocks/slice.ts";
export type {
  Block,
  BlockCreated,
  BlockDeleted,
  BlockEdited,
  BlockIndented,
  BlockMoved,
  BlockOutdented,
  Found,
  Page,
  Place,
} from "./blocks/blocks.ts";
export type { PageEvent } from "./blocks/slice.ts";
export { getDays, getPages, getPreviews, linking, locateBlock, searchBlocks, shownOrder } from "./blocks/queries.ts";
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
export { predictAliases } from "./aliases/slice.ts";
export { addAlias, removeAlias } from "./aliases/commands.ts";
export type { HeldAlias, Inert } from "./resolve/effect/effect.ts";
export type { AliasEvent } from "./aliases/slice.ts";
export { iconSet } from "./icons/set/set.ts";
export { iconRemoved } from "./icons/removed/removed.ts";
export { predictIcon } from "./icons/slice.ts";
export { removeIcon, setIcon } from "./icons/commands.ts";
export type { IconRemoved, IconSet } from "./icons/icons.ts";
export type { IconEvent } from "./icons/slice.ts";
export { getDeletions, getRefsTo, hasContent } from "./pages/delete.ts";
export { pageDeleted } from "./pages/deleted/deleted.ts";
export { pageRenamed } from "./pages/renamed/renamed.ts";
export { deletePage, renamePage } from "./pages/commands.ts";
export type { PageRenamed, Renamed } from "./pages/rename.ts";
export type { PageDeleted } from "./pages/delete.ts";
export type { PagesEvent } from "./pages/slice.ts";
export { blockCreated } from "./blocks/created/created.ts";
export { blockEdited } from "./blocks/edited/edited.ts";
export { blockDeleted } from "./blocks/deleted/deleted.ts";
export { blockIndented } from "./blocks/indented/indented.ts";
export { blockOutdented } from "./blocks/outdented/outdented.ts";
export { blockMoved } from "./blocks/moved/moved.ts";
export {
  addBlock,
  deleteBlock,
  deleteBlocks,
  indentBlocks,
  outdentBlocks,
  editBlock,
  indentBlock,
  moveBlock,
  moveBlocks,
  outdentBlock,
  pasteBlocks,
} from "./blocks/commands.ts";
export type { Pasting } from "./blocks/commands.ts";
export { pasted } from "./blocks/paste/paste.ts";
export type { PasteAt } from "./blocks/paste/paste.ts";
export { getEdited } from "./edited/edited.ts";
export { checked, labelled, readTask, withMarker } from "./tasks/tasks.ts";
export type { Marker } from "./tasks/tasks.ts";
export { getTasks } from "./tasks/queries.ts";
export type { Tasks } from "./tasks/queries.ts";
export { countBlocks, countLinks } from "./blocks/queries.ts";
export { inCode, read } from "./reading/reading.ts";
export { spans } from "./spans/spans.ts";
export type { Span } from "./spans/spans.ts";
export { bareTag, remarkPlugins, remarkWikilink } from "./wikilink/wikilink.ts";

/**
 * The graph: every page, by `canonicalize`: the blocks on it, its properties,
 * its tags, its aliases, its icon, the first spelling the fold saw for it, how many
 * times it has been deleted, and when it last changed.
 *
 * A key of `__proto__` is an ordinary key throughout (#62), and all of it
 * survives a structured clone (#146): every map in it is an immutable map of
 * plain data (#276), so an event costs the rows it touches.
 */
export type Graph = BlockState &
  PropertyState &
  TagState &
  AliasState &
  IconState &
  DeleteState &
  RenameState &
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
  | IconEvent["type"]
  | PagesEvent["type"]
  | BatchEvent["type"],
  number
> = {
  ...BLOCK_HANDLES,
  ...PROPERTY_HANDLES,
  ...TAG_HANDLES,
  ...ALIAS_HANDLES,
  ...ICON_HANDLES,
  ...PAGE_HANDLES,
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
    ...noBlocks(),
    titles: emptyMap(),
    properties: emptyMap(),
    tags: emptyMap(),
    aliases: emptyMap(),
    icons: emptyMap(),
    deletions: emptyMap(),
    renames: emptyMap(),
    edited: emptyMap(),
  } as Graph,
};

// ── Undo (#233, #242) ───────────────────────────────────────────────────────

/** A step as it is remembered: what undoes it, and what it must find. No graph. */
export type Remembered = RememberedWith<Graph>;

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
  ...ICON_UNDO,
  ...PAGE_UNDO,
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
 * `events`, written on `before`, as a step is remembered: the events that
 * undo it, and what it has to find to be undone. Keeps no graph, so `before`
 * and the graph after can be let go once it returns. See the README.
 */
export function remember(before: Graph, events: readonly Batched[]): Remembered {
  return rememberWith(graphFold.reduce, UNDO, before, events);
}

/**
 * Whether a remembered step can still be undone in `now`: everything it
 * touched is as it left it, so undoing it undoes nobody else's work.
 */
export function holds(now: Graph, remembered: Remembered): boolean {
  return holdsWith(now, remembered);
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
    [readsBlocks, readsProperties, readsTags, readsAliases, readsIcons, readsDeletes].some((reads) =>
      reads(event),
    )
  );
}

/** One event past the gate: every slice, then when its page changed. */
function one(state: Graph, event: Incoming): Graph {
  const routed = redirected(state, event);
  return reduceEdited(state, behindTheGate(state, routed), routed);
}

/**
 * `event` with the page it names sent where a rename sent that page, while
 * the alias the rename left stands (#108). A write that sorts after a rename,
 * from a device that had not seen it, lands on the page it was meant for,
 * rather than giving the old name content of its own and taking it back.
 * Every event that names its page as `page` is sent: blocks, properties,
 * tags, aliases, icons and a page delete. A rename names two pages, and is not.
 */
function redirected(state: Graph, event: Incoming): Incoming {
  if (unnamed(event.type) === "page.renamed") return event;
  const { payload } = event;
  if (typeof payload !== "object" || payload === null) return event;
  const page = field(payload, "page");
  const to = typeof page === "string" ? redirect(state, page) : undefined;
  return to === undefined ? event : { ...event, payload: { ...payload, page: titleOf(state, to) } };
}

/** Each slice's fold in turn. The delete fold empties what the others hold. */
function behindTheGate(state: Graph, event: { type: string; payload: unknown }): Graph {
  const slices: ((state: Graph, event: { type: string; payload: unknown }) => Graph)[] = [
    reduce,
    reduceProperties,
    reduceTags,
    reduceAliases,
    reduceIcons,
    reduceDeletes,
  ];
  return slices.reduce((folded, slice) => slice(folded, event), state);
}

/** Every title something names now: blocks, links, properties, tags, aliases and icons. */
function named(state: Graph): string[] {
  return [
    ...namedByBlocks(state),
    ...namedByProperties(state),
    ...namedByTags(state),
    ...namedByAliases(state),
    ...namedByIcons(state),
  ];
}

// ── Names: what a name opens (#221) ─────────────────────────────────────────
//
// The slices' own reads take a page's title as written. These go through
// `resolve` first, so a page reached by an alias or a date name is the page
// it opens: its blocks, properties and tags, and what links to it by any of
// its names.

/** What resolving reads. */
type Names = BlockState & PropertyState & TagState & AliasState & IconState;

/**
 * The icon of the page `title` opens, as written, or undefined for none. The
 * graph never reads it: what it means, and whether it can be drawn, is the
 * reader's (#322).
 */
export function getIcon(state: Names, title: string): string | undefined {
  return iconOf(state, resolve(state, title));
}

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

/**
 * Every alias the page `page` opens holds (#383), in effect or not, each as
 * it shows and ordered by `canonicalize`, with why it is inert when it is.
 */
export function getHeldAliases(state: Names, page: string): HeldAlias[] {
  return heldAliases(state, page);
}

/**
 * Why `alias` would not open the page `page` opens, were it added to that
 * page (#383), or undefined when it would: what the alias input says while
 * a name is typed.
 */
export function getAliasing(state: Names, page: string, alias: string): Inert | undefined {
  return aliasing(state, page, alias);
}

/** The page `alias` opens as an alias in effect, as it shows, or undefined. */
export function getAliasOf(state: Names, alias: string): string | undefined {
  return resolver(state).aliasOf(alias);
}

/**
 * Each of `names` that a rename left behind (#108), with the title of the
 * page it became: what a window holding the old name, for a page it is not
 * showing, holds instead (#301). An alias someone added is not a rename, and
 * is not in the answer; nor is a name whose alias was removed since.
 */
export function getRenamed(state: Graph, names: readonly string[]): Renamed[] {
  return renamedTo(state, names);
}

/** A page title search offered, and the page following it opens. */
export type PageMatch = {
  /** As it shows. What a link to it is written as. */
  title: string;
  /** The page it opens, as it shows: `title` itself unless it resolves elsewhere. */
  opens: string;
  /** The icon of the page it opens (#329), as written; absent for none. */
  icon?: string;
};

/**
 * Every name search offers, by key, each in the spelling it shows: every
 * title something names, and each day one of them opens, by its title and
 * its built-in names: a day named by a link to `Nov 4th, 2024` is offered as
 * `2024-11-04` and `November 4th, 2024` too. A name a rename left behind is
 * not offered (#108): it still opens the page, as a safety net.
 */
function offered(state: Graph): Map<string, string> {
  const opens = resolver(state);
  const away = renamedAway(state);
  const names = new Map<string, string>();
  for (const title of named(state)) {
    const key = canonicalize(title);
    if (!names.has(key) && !away.has(key)) names.set(key, titleOf(state, key));
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
 * alias, a page with one, or an icon on it. A day anything names is offered by its date
 * names too, so `Nov 4` finds `Nov 4th, 2024`. Each is offered once, in the
 * spelling it shows.
 */
export function searchNames(state: Graph, query: string, limit = 10): PageMatch[] {
  const names = resolver(state);
  return search(offered(state).values(), query, limit).map((title) => {
    const opens = names.title(title);
    const icon = iconOf(state, opens);
    return { title, opens, ...(icon === undefined ? {} : { icon }) };
  });
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
  /** Its icon (#329), as written; absent for none. */
  icon?: string;
};

/**
 * Every page, as `searchPages` counts one, journal days included, each once
 * in the spelling it shows, A to Z. With what is on it, what links to it,
 * what tags it, when it last changed and its icon.
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
      const edited = getKey(state.edited, key);
      const icon = iconOf(state, key);
      return {
        title: titleOf(state, key),
        blocks: countBlocks(state, key),
        references: links.get(key) ?? 0,
        taggedBy: tagged.get(key) ?? 0,
        ...(edited === undefined ? {} : { edited }),
        ...(icon === undefined ? {} : { icon }),
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
