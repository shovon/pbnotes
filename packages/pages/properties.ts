/**
 * Page properties: values about a page itself, such as a status, its aliases
 * or a cover (#84). The events, the fold over them, and the reads.
 *
 * A page's properties are a tree. A key is a path, a non-empty list of
 * strings, and every node on it holds a value, a set of items, both, or
 * nothing but what is under it. Nobody declares which a key is before writing
 * to it, and the format gives no key a meaning: "the cover is the value at
 * `["app", "cover"]`" is a rule in whatever reads it, not in the events.
 *
 * The fold is two steps, kept apart. `parse` takes a payload from a shared
 * folder, which may be anything, and either turns it into edits or refuses
 * it whole. `apply` takes edits it can trust and changes the state. Every
 * event is a list of edits, each one a change to one path's entry, and edits
 * compose: `removed` is nothing but several of the edits the four single
 * events make, applied in one go.
 *
 * Like `blocks.ts`, nothing here touches a log, a clock or a window.
 */

import { NAMESPACE, spell } from "./blocks.ts";
import { canonicalize } from "./canonicalize.ts";

/**
 * A value or an item. The four types stay distinct: `1`, `"1"`, `true` and
 * `null` are four values. `null` is a value, not an absence: `unset` is how
 * a path stops having one.
 *
 * A number is a JSON number, so finite. A string is kept in NFC by the fold.
 */
export type Scalar = string | number | boolean | null;

/** The value at `path` is now `value`. Its items are untouched. */
export type PropertySet = { page: string; path: string[]; value: Scalar };

/** `path` has no value. Its items are untouched. */
export type PropertyUnset = { page: string; path: string[] };

/**
 * `item` is among the items at `path`. Adding one that is already there moves
 * it to the end, which is what makes the last item the latest. The value is
 * untouched.
 */
export type PropertyItemAdded = { page: string; path: string[]; item: Scalar };

/** `item` is no longer among the items at `path`. The value is untouched. */
export type PropertyItemRemoved = { page: string; path: string[]; item: Scalar };

/**
 * What a writer saw at one path when it removed a property.
 *
 * `value` absent: there was no value here, so the value is left alone.
 * Present, `null` included: the value is removed only if it is still this
 * one, so a value another device set that the remover never saw stays.
 */
export type Seen = { path: string[]; value?: Scalar; items: Scalar[] };

/**
 * A property removed: for each path in `seen`, the value if it is still the
 * one seen, and each item listed. What the writer did not see stays, which
 * is why there is no "delete everything under this path": that would also
 * remove what another device added in the meantime.
 *
 * One event for the whole removal, so a crash cannot leave half of it.
 */
export type PropertyRemoved = { page: string; seen: Seen[] };

/** An event type as it is written: under the namespace. */
type Named<T extends string> = `${typeof NAMESPACE}${T}`;

/**
 * Every property event and its payload. No timestamp in any of them: the
 * event's own `at` is when it was written, and this fold keeps no time.
 */
export type PropertyEvent =
  | { type: Named<"page.property.set">; payload: PropertySet }
  | { type: Named<"page.property.unset">; payload: PropertyUnset }
  | { type: Named<"page.property.item.added">; payload: PropertyItemAdded }
  | { type: Named<"page.property.item.removed">; payload: PropertyItemRemoved }
  | { type: Named<"page.property.removed">; payload: PropertyRemoved };

/** Event type → the payload `v` this build reads and writes. See `HANDLES`. */
export const PROPERTY_HANDLES: Record<PropertyEvent["type"], number> = {
  [`${NAMESPACE}page.property.set`]: 1,
  [`${NAMESPACE}page.property.unset`]: 1,
  [`${NAMESPACE}page.property.item.added`]: 1,
  [`${NAMESPACE}page.property.item.removed`]: 1,
  [`${NAMESPACE}page.property.removed`]: 1,
};

/**
 * What one path holds. Never empty: an entry with no value and no items is
 * deleted, so a node with nothing in it is no node.
 *
 * The value is boxed so that `null`, a value, and no value stay apart. Items
 * are keyed by their JSON, so `1` and `"1"` are two keys, and kept in the
 * order they were last added.
 */
export type Entry = {
  /** Trimmed and in NFC. */
  path: string[];
  value?: { v: Scalar };
  items: Map<string, Scalar>;
};

/**
 * Every page's properties: page key (`canonicalize`) → JSON of the path → entry.
 * Flat, keyed by path, not a stored tree: an event touches only the entries
 * it names, and the tree is a reading of this map that cannot disagree with
 * it. `Map` throughout, so a title, a segment or an item of `__proto__` is an
 * ordinary key (#62).
 */
export type Properties = Map<string, Map<string, Entry>>;

/** One change to one path's entry. Returns the same entry when nothing changes. */
type Edit = { path: string[]; change: (entry: Entry) => Entry };

const keyOf = (value: Scalar | string[]): string => JSON.stringify(value);

const setValue =
  (v: Scalar) =>
  (entry: Entry): Entry => ({ ...entry, value: { v } });

function unsetValue(entry: Entry): Entry {
  if (!entry.value) return entry;
  const { value: _, ...rest } = entry;
  return rest;
}

const unsetIf =
  (v: Scalar) =>
  (entry: Entry): Entry =>
    entry.value && keyOf(entry.value.v) === keyOf(v) ? unsetValue(entry) : entry;

const addItem =
  (item: Scalar) =>
  (entry: Entry): Entry => {
    const key = keyOf(item);
    const items = new Map(entry.items);
    items.delete(key);
    items.set(key, item);
    return { ...entry, items };
  };

const removeItem =
  (item: Scalar) =>
  (entry: Entry): Entry => {
    const key = keyOf(item);
    if (!entry.items.has(key)) return entry;
    const items = new Map(entry.items);
    items.delete(key);
    return { ...entry, items };
  };

/** A field the payload holds itself, never one every object inherits. */
function field(payload: object, name: string): unknown {
  return Object.hasOwn(payload, name)
    ? (payload as Record<string, unknown>)[name]
    : undefined;
}

/**
 * A scalar as the fold keeps it, boxed so that `null` is not a refusal:
 * strings in NFC, `-0` as `0`. Undefined for anything that is not a scalar,
 * a non-finite number among them.
 *
 * `undefined` is refused, never read as "no value": `JSON.stringify` leaves a
 * field holding it out, so on disk it is absent, and the event has to fold
 * the same in memory as it will after a reopen.
 */
function scalar(value: unknown): { v: Scalar } | undefined {
  if (value === null) return { v: null };
  if (typeof value === "boolean") return { v: value };
  if (typeof value === "string") return { v: value.normalize("NFC") };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { v: value === 0 ? 0 : value };
  }
  return undefined;
}

/** A segment as the fold keeps it: trimmed, then NFC. Undefined if that leaves nothing. */
function segment(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().normalize("NFC");
  return trimmed === "" ? undefined : trimmed;
}

/** Every segment as the fold keeps it, or undefined if any one is refused. */
function segments(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const it of value) {
    const kept = segment(it);
    if (kept === undefined) return undefined;
    out.push(kept);
  }
  return out;
}

/** A path for an event: segments, and at least one. */
function pathOf(value: unknown): string[] | undefined {
  const path = segments(value);
  return path && path.length > 0 ? path : undefined;
}

/** The edits one entry of a `removed` makes, or undefined if it is malformed. */
function seenEdits(seen: unknown): Edit[] | undefined {
  if (typeof seen !== "object" || seen === null) return undefined;
  const path = pathOf(field(seen, "path"));
  const listed = field(seen, "items");
  if (!path || !Array.isArray(listed)) return undefined;
  const edits: Edit[] = [];
  const raw = field(seen, "value");
  if (raw !== undefined) {
    const value = scalar(raw);
    if (!value) return undefined;
    edits.push({ path, change: unsetIf(value.v) });
  }
  for (const it of listed) {
    const item = scalar(it);
    if (!item) return undefined;
    edits.push({ path, change: removeItem(item.v) });
  }
  return edits;
}

/**
 * A property event as edits to one page, or undefined for anything else: an
 * event that is not a property event, or one whose payload is malformed. A
 * malformed event is skipped whole, never applied in part, and not reported
 * (#104): it came from a shared folder, and may be anything.
 */
function parse(
  type: string,
  payload: unknown,
): { page: string; edits: Edit[] } | undefined {
  if (!type.startsWith(NAMESPACE)) return undefined;
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = field(payload, "page");
  if (typeof page !== "string" || canonicalize(page) === "") return undefined;

  const named = type.slice(NAMESPACE.length);
  if (named === "page.property.removed") {
    const seen = field(payload, "seen");
    if (!Array.isArray(seen) || seen.length === 0) return undefined;
    const edits: Edit[] = [];
    for (const it of seen) {
      const more = seenEdits(it);
      if (!more) return undefined;
      edits.push(...more);
    }
    return { page, edits };
  }

  const path = pathOf(field(payload, "path"));
  if (!path) return undefined;
  switch (named) {
    case "page.property.set": {
      const value = scalar(field(payload, "value"));
      return value && { page, edits: [{ path, change: setValue(value.v) }] };
    }
    case "page.property.unset":
      return { page, edits: [{ path, change: unsetValue }] };
    case "page.property.item.added": {
      const item = scalar(field(payload, "item"));
      return item && { page, edits: [{ path, change: addItem(item.v) }] };
    }
    case "page.property.item.removed": {
      const item = scalar(field(payload, "item"));
      return item && { page, edits: [{ path, change: removeItem(item.v) }] };
    }
    default:
      return undefined;
  }
}

/**
 * `edits` applied in order to one page's entries. An entry left with nothing
 * is deleted, then a page left with no entries. The same map back when no
 * edit changed anything.
 */
function apply(properties: Properties, page: string, edits: Edit[]): Properties {
  const key = canonicalize(page);
  const entries = new Map(properties.get(key));
  let changed = false;
  for (const { path, change } of edits) {
    const at = keyOf(path);
    const current = entries.get(at) ?? { path, items: new Map() };
    const next = change(current);
    if (next === current) continue;
    changed = true;
    if (next.value === undefined && next.items.size === 0) entries.delete(at);
    else entries.set(at, next);
  }
  if (!changed) return properties;
  const out = new Map(properties);
  if (entries.size === 0) out.delete(key);
  else out.set(key, entries);
  return out;
}

/**
 * The property fold: applies one property event, and hands back `state`
 * itself for every other event, so it composes with the block fold.
 *
 * Applied in the order the ledger folds, which is all "the later write wins"
 * needs: each value and each item merges on its own, so two devices writing
 * different paths, or different items on one path, never overwrite each
 * other, and there are no tombstones.
 *
 * A property event spells its page's title the way `block.created` does: the
 * first spelling the fold sees, from a block or a property, is the one kept.
 *
 * Pure, and it never changes what it is handed: the ledger keeps earlier
 * states as checkpoints. Reads only what it declares, so any state with
 * `titles` and `properties` folds through it.
 */
export function reduceProperties<
  S extends { titles: Map<string, string>; properties: Properties },
>(state: S, event: { type: string; payload: unknown }): S {
  const parsed = parse(event.type, event.payload);
  if (!parsed) return state;
  const properties = apply(state.properties, parsed.page, parsed.edits);
  const titles = spell(state.titles, [parsed.page]);
  return properties === state.properties && titles === state.titles
    ? state
    : { ...state, properties, titles };
}

/** What a read hands back about one path. A snapshot: changing it changes nothing. */
export type Property = {
  path: string[];
  value: Scalar | undefined;
  items: ReadonlySet<Scalar>;
};

/** What the reads look at. `Pages` is one. */
type Holds = { readonly properties: Properties };

const nothing = (path: string[]): Property => ({
  path,
  value: undefined,
  items: new Set(),
});

function snapshot(entry: Entry): Property {
  return {
    path: [...entry.path],
    value: entry.value?.v,
    items: new Set(entry.items.values()),
  };
}

/** Whether `path` is `scope` or under it, segment by segment. */
function within(path: string[], scope: string[]): boolean {
  return scope.length <= path.length && scope.every((it, i) => path[i] === it);
}

/** Two strings by codepoint, not by UTF-16 unit, so the order is the same everywhere. */
function byCodepoint(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < x.length && i < y.length; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
}

/** Two paths segment by segment; a path sorts before what is under it. */
function byPath(a: string[], b: string[]): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    const order = byCodepoint(a[i], b[i]);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

/**
 * The entries of a page under `scope`, as the fold keeps them. A scope is
 * read the way the fold reads a path, so `[" status "]` finds `["status"]`;
 * one with a segment that is empty once trimmed finds nothing.
 */
function under(holds: Holds, page: string, scope: string[]): Entry[] {
  const kept = segments(scope);
  const entries = holds.properties.get(canonicalize(page));
  if (!kept || !entries) return [];
  return [...entries.values()].filter((entry) => within(entry.path, kept));
}

/**
 * What `path` holds on `page`: its value and its items, both, so no reader
 * has to choose. A path with nothing at it reads as no value and no items,
 * the same as one never written. `[]`, the page root, holds nothing.
 */
export function get(holds: Holds, page: string, path: string[]): Property {
  const kept = segments(path);
  if (!kept) return nothing([...path]);
  const entry = holds.properties.get(canonicalize(page))?.get(keyOf(kept));
  return entry ? snapshot(entry) : nothing(kept);
}

/** The value at `path` on `page`, or undefined for none. `null` is a value. */
export function getValue(holds: Holds, page: string, path: string[]): Scalar | undefined {
  return get(holds, page, path).value;
}

/** The items at `path` on `page`, latest last. Empty, never undefined. */
export function getItems(holds: Holds, page: string, path: string[]): ReadonlySet<Scalar> {
  return get(holds, page, path).items;
}

/**
 * Every path on `page` at or under `scope` that holds a value or an item,
 * sorted by path. `list(pages, page)` is every property the page has.
 */
export function list(holds: Holds, page: string, scope: string[] = []): Property[] {
  return under(holds, page, scope)
    .sort((a, b) => byPath(a.path, b.path))
    .map(snapshot);
}

/**
 * The next segment of every path on `page` strictly under `path`, each once,
 * sorted. Calling it again on each name walks the whole tree; `[]` means
 * nothing further down.
 */
export function children(holds: Holds, page: string, path: string[]): string[] {
  const depth = path.length;
  const names = new Set(
    under(holds, page, path)
      .filter((entry) => entry.path.length > depth)
      .map((entry) => entry.path[depth]),
  );
  return [...names].sort(byCodepoint);
}

/**
 * A path from text, `"a/b/c"` → `["a", "b", "c"]`, for code and UI that like
 * typing strings. Never what the ledger holds: a segment may contain a `/`,
 * and the events carry the array.
 */
export function path(text: string): string[] {
  return text.split("/");
}

/** A path as text, `["a", "b", "c"]` → `"a/b/c"`, for display. */
export function showPath(parts: string[]): string {
  return parts.join("/");
}
