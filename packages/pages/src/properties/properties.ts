/**
 * Page properties: a key and a string value on a page, and everything that
 * knows what one is: the event schema, the fold, the builders and the read.
 *
 * A key is a page title, compared through `canonicalize` like any other, so
 * setting `Status` on `Foo` names two pages, `Foo` and `Status`. Naming is
 * all it does: a property never creates a page. A page that only properties
 * name stops being one when the last of them goes, as a page that only a
 * link names does when the link goes.
 *
 * Nothing here reads blocks, and nothing in the block fold reads this.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field, NAMESPACE, unnamed } from "../events/events.ts";
import type { Named } from "../events/events.ts";
import { spell, titleOf } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";

/**
 * What the property fold reads and writes: `canonicalize(page)` →
 * `canonicalize(key)` → value. A page with no properties has no entry, never
 * an empty one. The spelling of every page and key is in `titles`.
 *
 * `Map` throughout, so `__proto__` is an ordinary page or key (#62), and the
 * state survives the structured clone to the renderer (#146).
 */
export type PropertyState = {
  readonly properties: Map<string, Map<string, string>>;
  readonly titles: Titles;
};

// ── The events ──────────────────────────────────────────────────────────────

/**
 * `page`'s `key` is now `value`. A value is a plain string: it is not read for
 * links, and `""` is a value, not an absence.
 */
export type PropertySet = { page: string; key: string; value: string };

/** `page` no longer has `key`. */
export type PropertyRemoved = { page: string; key: string };

/** Every event this fold understands, and its payload. */
export type PropertyEvent =
  | { type: Named<"property.set">; payload: PropertySet }
  | { type: Named<"property.removed">; payload: PropertyRemoved };

/** A `PropertyEvent` with the namespace off its type. */
type Bare<E = PropertyEvent> = E extends {
  type: `${typeof NAMESPACE}${infer T}`;
  payload: infer P;
}
  ? { type: T; payload: P }
  : never;

/**
 * Event type → the payload `v` this build folds and writes. The property half
 * of `HANDLES`; the gate that reads it is `pagesFold`.
 */
export const PROPERTY_HANDLES: Record<PropertyEvent["type"], number> = {
  [`${NAMESPACE}property.set`]: 1,
  [`${NAMESPACE}property.removed`]: 1,
};

// ── The fold: parse, then apply ─────────────────────────────────────────────

/** A string field that is not blank once trimmed, or undefined. */
function title(payload: object, name: string): string | undefined {
  const value = field(payload, name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * A property event as this build reads it, or undefined for anything else:
 * not one of ours, or malformed. Malformed is skipped whole. Any field the
 * payload has beyond these is ignored.
 */
function parse(event: { type: string; payload: unknown }): Bare | undefined {
  const name = unnamed(event.type);
  const payload = event.payload;
  if (!name || typeof payload !== "object" || payload === null) return undefined;
  const page = title(payload, "page");
  const key = title(payload, "key");
  if (!page || !key) return undefined;

  switch (name) {
    case "property.set": {
      const value = field(payload, "value");
      return typeof value === "string"
        ? { type: name, payload: { page, key, value } }
        : undefined;
    }
    case "property.removed":
      return { type: name, payload: { page, key } };
    default:
      return undefined;
  }
}

/** One parsed event applied. Pure, and never changes what it is handed. */
function apply<S extends PropertyState>(state: S, it: Bare): S {
  const { page, key } = it.payload;
  const titles = spell(state.titles, [page, key]);
  const at = canonicalize(page);
  const held = state.properties.get(at);

  if (it.type === "property.set") {
    const next = new Map(held).set(canonicalize(key), it.payload.value);
    return { ...state, titles, properties: new Map(state.properties).set(at, next) };
  }

  if (!held?.has(canonicalize(key))) {
    return titles === state.titles ? state : { ...state, titles };
  }
  const next = new Map(held);
  next.delete(canonicalize(key));
  const properties = new Map(state.properties);
  if (next.size === 0) properties.delete(at);
  else properties.set(at, next);
  return { ...state, titles, properties };
}

/**
 * The property fold: one event in, the state out. Hands back `state` itself
 * for any event that is not a well-formed property event.
 */
export function reduce<S extends PropertyState>(
  state: S,
  event: { type: string; payload: unknown },
): S {
  const parsed = parse(event);
  return parsed ? apply(state, parsed) : state;
}

// ── Builders ────────────────────────────────────────────────────────────────

/** One event as it is written, with the `v` the gate reads. */
type Built<T extends Bare["type"]> = Extract<PropertyEvent, { type: Named<T> }> & { v: number };

function build<T extends Bare["type"]>(
  name: T,
  payload: Extract<Bare, { type: T }>["payload"],
): Built<T> {
  const type = `${NAMESPACE}${name}` as Named<T>;
  return { v: PROPERTY_HANDLES[type], type, payload } as Built<T>;
}

/** The `property.set` event: `page`'s `key` is now `value`. */
export function propertySet(page: string, key: string, value: string): Built<"property.set"> {
  return build("property.set", { page, key, value });
}

/** The `property.removed` event: `page` no longer has `key`. */
export function propertyRemoved(page: string, key: string): Built<"property.removed"> {
  return build("property.removed", { page, key });
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** One property as a page shows it: the key in its spelling, and the value. */
export type Property = { key: string; value: string };

/**
 * `page`'s properties, each key in the spelling it shows, ordered by
 * `canonicalize(key)` so every machine lists them alike. Empty for a page
 * with none.
 */
export function getProperties(state: PropertyState, page: string): Property[] {
  const held = state.properties.get(canonicalize(page)) ?? new Map<string, string>();
  return [...held]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => ({ key: titleOf(state, key), value }));
}

/**
 * `page`'s properties as they will stand once `events` are recorded: a view's
 * writes still in flight, folded over the properties main last sent for it. A
 * guess, thrown away as each write settles.
 *
 * Folded with `reduce`, so what is drawn is what will be recorded. Both events
 * are safe to fold twice, so one the properties already show changes nothing.
 * Any event that is not a property event on `page` is passed over.
 */
export function predictProperties(
  properties: readonly Property[],
  page: string,
  events: readonly { type: string; payload: unknown }[],
): Property[] {
  if (events.length === 0) return [...properties];
  const at = canonicalize(page);
  const held = new Map(properties.map(({ key, value }) => [canonicalize(key), value]));
  let state: PropertyState = {
    properties: held.size === 0 ? new Map() : new Map([[at, held]]),
    titles: new Map([
      [at, page],
      ...properties.map(({ key }): [string, string] => [canonicalize(key), key]),
    ]),
  };
  for (const event of events) state = reduce(state, event);
  return getProperties(state, page);
}

/** Every title the properties name: each page that has one, and each key. */
export function* named(state: PropertyState): Generator<string> {
  for (const [page, held] of state.properties) {
    yield page;
    yield* held.keys();
  }
}
