/**
 * Properties: values about anything you can touch, a page or a block, such as
 * a status, a page's aliases or its cover (#84, #155). The events, the fold
 * over them, and the reads.
 *
 * Every event names what it is about with a `Target`, and everything below it
 * is the same for every kind: one model, one fold, one set of reads. A new
 * kind is a new `Target` variant, not new events.
 *
 * A target's properties are a tree. A key is a path, a non-empty list of
 * strings, and every node on it holds a value, a set of items, both, or
 * nothing but what is under it. Nobody declares which a key is before writing
 * to it, and the format gives no key a meaning: "the cover is the value at
 * `["app", "cover"]`" is a rule in whatever reads it, not in the events.
 *
 * The fold is two steps, kept apart. `parseProperty` takes a payload from a
 * shared folder, which may be anything, and either turns it into edits or
 * refuses it whole. `foldProperty` takes edits it can trust and changes the
 * state. Every event is a list of edits, each one a change to one path's
 * entry, and edits compose: `removed` is nothing but several of the edits the
 * four single events make, applied in one go.
 *
 * Whether a target exists is not this slice's call: it knows nothing about
 * blocks. `pages.ts` decides which events reach the fold and what a deleted
 * block takes with it (`forget`).
 *
 * Like `blocks.ts`, nothing here touches a log, a clock or a window.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field, NAMESPACE, unnamed } from "../events/events.ts";
import type { Named } from "../events/events.ts";
import { spell } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";

/**
 * What a property is about. Tagged, so the parser switches on one field and
 * an unknown kind is refused, never guessed at. Each kind names its subject
 * its own way: a page by a title (`canonicalize`d for the key, first spelling
 * kept), a block by its opaque id.
 */
export type Target = { kind: "page"; title: string } | { kind: "block"; id: string };

export type Kind = Target["kind"];

/**
 * A value or an item. The four types stay distinct: `1`, `"1"`, `true` and
 * `null` are four values. `null` is a value, not an absence: `unset` is how
 * a path stops having one.
 *
 * A number is a JSON number, so finite. A string is kept in NFC by the fold.
 */
export type Scalar = string | number | boolean | null;

/** The value at `path` is now `value`. Its items are untouched. */
export type PropertySet = { of: Target; path: string[]; value: Scalar };

/** `path` has no value. Its items are untouched. */
export type PropertyUnset = { of: Target; path: string[] };

/**
 * `item` is among the items at `path`. Adding one that is already there moves
 * it to the end, which is what makes the last item the latest. The value is
 * untouched.
 */
export type PropertyItemAdded = { of: Target; path: string[]; item: Scalar };

/** `item` is no longer among the items at `path`. The value is untouched. */
export type PropertyItemRemoved = { of: Target; path: string[]; item: Scalar };

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
export type PropertyRemoved = { of: Target; seen: Seen[] };

/**
 * Every property event and its payload. No timestamp in any of them: the
 * event's own `at` is when it was written, and this fold keeps no time.
 */
export type PropertyEvent =
  | { type: Named<"property.set">; payload: PropertySet }
  | { type: Named<"property.unset">; payload: PropertyUnset }
  | { type: Named<"property.item.added">; payload: PropertyItemAdded }
  | { type: Named<"property.item.removed">; payload: PropertyItemRemoved }
  | { type: Named<"property.removed">; payload: PropertyRemoved };

/** Event type → the payload `v` this build reads and writes. See `HANDLES`. */
export const PROPERTY_HANDLES: Record<PropertyEvent["type"], number> = {
  [`${NAMESPACE}property.set`]: 1,
  [`${NAMESPACE}property.unset`]: 1,
  [`${NAMESPACE}property.item.added`]: 1,
  [`${NAMESPACE}property.item.removed`]: 1,
  [`${NAMESPACE}property.removed`]: 1,
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

/** One target's entries: JSON of the path → entry. */
export type Entries = Map<string, Entry>;

/**
 * Everything's properties: kind → subject (`subjectOf`) → entries. Flat
 * below the subject, keyed by path, not a stored tree: an event touches only
 * the entries it names, and the tree is a reading of this map that cannot
 * disagree with it. A subject with no entries, and a kind with no subjects,
 * are deleted. `Map` throughout, so a title, a segment or an item of
 * `__proto__` is an ordinary key (#62).
 */
export type Properties = Map<Kind, Map<string, Entries>>;

/** One change to one path's entry. Returns the same entry when nothing changes. */
type Edit = { path: string[]; change: (entry: Entry) => Entry };

/** A property event as edits to one target: what `parseProperty` hands `foldProperty`. */
export type Parsed = { of: Target; edits: Edit[] };

const keyOf = (value: Scalar | string[]): string => JSON.stringify(value);

/** The key a target's entries are kept under, within its kind. */
function subjectOf(of: Target): string {
  switch (of.kind) {
    case "page":
      return canonicalize(of.title);
    case "block":
      return of.id;
  }
}

const setValue =
  (v: Scalar) =>
  (entry: Entry): Entry =>
    entry.value && keyOf(entry.value.v) === keyOf(v) ? entry : { ...entry, value: { v } };

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

/**
 * A target for an event, or undefined: not an object, a kind this build does
 * not know, or a kind without its own field (`{ kind: "page", id }`). Fields
 * a kind does not read are ignored.
 */
function targetOf(value: unknown): Target | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const kind = field(value, "kind");
  switch (kind) {
    case "page": {
      const title = field(value, "title");
      return typeof title === "string" && canonicalize(title) !== ""
        ? { kind, title }
        : undefined;
    }
    case "block": {
      const id = field(value, "id");
      return typeof id === "string" && id !== "" ? { kind, id } : undefined;
    }
    default:
      return undefined;
  }
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

/** The edits a property event's own payload makes, or undefined if it is malformed. */
function editsOf(named: string, payload: object): Edit[] | undefined {
  if (named === "property.removed") {
    const seen = field(payload, "seen");
    if (!Array.isArray(seen) || seen.length === 0) return undefined;
    const edits: Edit[] = [];
    for (const it of seen) {
      const more = seenEdits(it);
      if (!more) return undefined;
      edits.push(...more);
    }
    return edits;
  }

  const path = pathOf(field(payload, "path"));
  if (!path) return undefined;
  switch (named) {
    case "property.set": {
      const value = scalar(field(payload, "value"));
      return value && [{ path, change: setValue(value.v) }];
    }
    case "property.unset":
      return [{ path, change: unsetValue }];
    case "property.item.added": {
      const item = scalar(field(payload, "item"));
      return item && [{ path, change: addItem(item.v) }];
    }
    case "property.item.removed": {
      const item = scalar(field(payload, "item"));
      return item && [{ path, change: removeItem(item.v) }];
    }
    default:
      return undefined;
  }
}

/**
 * A property event as edits to one target, or undefined for anything else:
 * an event that is not a property event, or one whose payload is malformed.
 * A malformed event is skipped whole, never applied in part, and not reported
 * (#104): it came from a shared folder, and may be anything.
 */
export function parseProperty(event: { type: string; payload: unknown }): Parsed | undefined {
  const named = unnamed(event.type);
  const { payload } = event;
  if (!named || typeof payload !== "object" || payload === null) return undefined;
  const of = targetOf(field(payload, "of"));
  if (!of) return undefined;
  const edits = editsOf(named, payload);
  return edits && { of, edits };
}

/**
 * `properties` with the `kind` subject `key` holding `entries`, or without it
 * when they are empty, and without the kind when it has no subjects left.
 */
function withSubject(
  properties: Properties,
  kind: Kind,
  key: string,
  entries: Entries,
): Properties {
  const subjects = new Map(properties.get(kind));
  if (entries.size === 0) subjects.delete(key);
  else subjects.set(key, entries);
  const out = new Map(properties);
  if (subjects.size === 0) out.delete(kind);
  else out.set(kind, subjects);
  return out;
}

/**
 * `edits` applied in order to one target's entries. An entry left with
 * nothing is deleted, then a target left with no entries. The same map back
 * when no edit changed anything.
 */
function apply(properties: Properties, of: Target, edits: Edit[]): Properties {
  const key = subjectOf(of);
  const entries = new Map(properties.get(of.kind)?.get(key));
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
  return changed ? withSubject(properties, of.kind, key, entries) : properties;
}

/**
 * Whether `parsed` would change anything in `properties`, compared the way
 * the fold compares: segments trimmed, strings in NFC. What the commands use
 * to write nothing when a write would mean nothing.
 *
 * `properties` alone, not titles: a page target spells its title the first
 * time it is named, but that is not a change to any property.
 */
export function changes(properties: Properties, { of, edits }: Parsed): boolean {
  return apply(properties, of, edits) !== properties;
}

/** The page names a target brings with it: a page's title, and nothing for a block. */
function namesOf(of: Target): string[] {
  switch (of.kind) {
    case "page":
      return [of.title];
    case "block":
      return [];
  }
}

/**
 * One parsed property event folded in. Hands back `state` itself when it
 * changes nothing.
 *
 * Applied in the order the ledger folds, which is all "the later write wins"
 * needs: each value and each item merges on its own, so two devices writing
 * different paths, or different items on one path, never overwrite each
 * other, and there are no tombstones.
 *
 * A page target spells its title the way `block.created` does: the first
 * spelling the fold sees, from a block or a property, is the one kept.
 *
 * Pure, and it never changes what it is handed: the ledger keeps earlier
 * states as checkpoints. Reads only what it declares, so any state with
 * `titles` and `properties` folds through it.
 */
export function foldProperty<S extends { titles: Titles; properties: Properties }>(
  state: S,
  { of, edits }: Parsed,
): S {
  const properties = apply(state.properties, of, edits);
  const titles = spell(state.titles, namesOf(of));
  return properties === state.properties && titles === state.titles
    ? state
    : { ...state, properties, titles };
}

/**
 * `properties` with nothing about any of `targets`. The same map back when
 * none of them had anything.
 */
export function forget(properties: Properties, targets: Target[]): Properties {
  let out = properties;
  for (const of of targets) {
    const key = subjectOf(of);
    if (out.get(of.kind)?.has(key)) out = withSubject(out, of.kind, key, new Map());
  }
  return out;
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

/** A target's entries, if it has any. */
const entriesOf = (holds: Holds, of: Target): Entries | undefined =>
  holds.properties.get(of.kind)?.get(subjectOf(of));

/**
 * The entries of a target under `scope`, as the fold keeps them. A scope is
 * read the way the fold reads a path, so `[" status "]` finds `["status"]`;
 * one with a segment that is empty once trimmed finds nothing.
 */
function under(holds: Holds, of: Target, scope: string[]): Entry[] {
  const kept = segments(scope);
  const entries = entriesOf(holds, of);
  if (!kept || !entries) return [];
  return [...entries.values()].filter((entry) => within(entry.path, kept));
}

/**
 * What `path` holds on `of`: its value and its items, both, so no reader has
 * to choose. A path with nothing at it reads as no value and no items, the
 * same as one never written. `[]`, the root, holds nothing.
 */
export function get(holds: Holds, of: Target, path: string[]): Property {
  const kept = segments(path);
  if (!kept) return nothing([...path]);
  const entry = entriesOf(holds, of)?.get(keyOf(kept));
  return entry ? snapshot(entry) : nothing(kept);
}

/** The value at `path` on `of`, or undefined for none. `null` is a value. */
export function getValue(holds: Holds, of: Target, path: string[]): Scalar | undefined {
  return get(holds, of, path).value;
}

/** The items at `path` on `of`, latest last. Empty, never undefined. */
export function getItems(holds: Holds, of: Target, path: string[]): ReadonlySet<Scalar> {
  return get(holds, of, path).items;
}

/**
 * Every path on `of` at or under `scope` that holds a value or an item,
 * sorted by path. `list(pages, of)` is every property it has.
 */
export function list(holds: Holds, of: Target, scope: string[] = []): Property[] {
  return under(holds, of, scope)
    .sort((a, b) => byPath(a.path, b.path))
    .map(snapshot);
}

/**
 * The next segment of every path on `of` strictly under `path`, each once,
 * sorted. Calling it again on each name walks the whole tree; `[]` means
 * nothing further down.
 */
export function children(holds: Holds, of: Target, path: string[]): string[] {
  const depth = path.length;
  const names = new Set(
    under(holds, of, path)
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
