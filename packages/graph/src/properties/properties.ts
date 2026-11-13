/**
 * Page properties: a key and a string value on a page, and everything that
 * knows what one is.
 *
 * A key is a page title, compared through `canonicalize` like any other, so
 * setting `Status` on `Foo` names two pages, `Foo` and `Status`. Naming is
 * all it does: a property never creates a page. A page that only properties
 * name stops being one when the last of them goes, as a page that only a
 * link names does when the link goes.
 *
 * This file holds what both property events share: the state, the payloads,
 * and how a page's value for a key is read and written. The events
 * themselves are in `events/properties/`, one module each, with the list that
 * puts them together (#238).
 *
 * Nothing here reads blocks, and nothing in the block fold reads this.
 */

import * as map from "../immutable/immutable.ts";
import type { ImmutableMap } from "../immutable/immutable.ts";
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field } from "../events/events.ts";
import { over } from "../over/over.ts";
import { spell, titleOf } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";

/**
 * What the property fold reads and writes: `canonicalize(page)` →
 * `canonicalize(key)` → value. A page with no properties has no entry, never
 * an empty one. The spelling of every page and key is in `titles`.
 *
 * Immutable maps all the way down (#276, #371), so `__proto__` is an
 * ordinary page or key (#62), a write costs one path of one page's map, and
 * the state survives the structured clone to the renderer (#146).
 */
export type PropertyState = {
  readonly properties: ImmutableMap<ImmutableMap<string>>;
  readonly titles: Titles;
};

/** `define` and `slice` for the property events. */
export const PROPERTY = over<PropertyState>();

// ── The payloads ────────────────────────────────────────────────────────────

/**
 * `page`'s `key` is now `value`. A value is a plain string: it is not read for
 * links, and `""` is a value, not an absence.
 */
export type PropertySet = { page: string; key: string; value: string };

/** `page` no longer has `key`. */
export type PropertyRemoved = { page: string; key: string };

/** A string field that is not blank once trimmed, or undefined. */
function title(payload: object, name: string): string | undefined {
  const value = field(payload, name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The page and key both property events carry, or undefined when the payload
 * is malformed: not an object, or a `page` or `key` that is not a string or is
 * blank once trimmed. Malformed is skipped whole. Any field the payload has
 * beyond what an event reads is ignored.
 */
export function readKey(payload: unknown): PropertyRemoved | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = title(payload, "page");
  const key = title(payload, "key");
  return page && key ? { page, key } : undefined;
}

// ── A page's value for a key ────────────────────────────────────────────────

/** `page`'s value for `key`, or undefined for none. */
export function valueOf(state: PropertyState, page: string, key: string): string | undefined {
  const held = map.get(state.properties, canonicalize(page));
  return held === undefined ? undefined : map.get(held, canonicalize(key));
}

/**
 * `state` with `page`'s `key` set to `value`, or removed when `value` is
 * undefined. Both names are spelled either way. Pure, and never changes what
 * it is handed: removing a key the page lacks hands back `state` itself
 * unless a spelling is new. Setting always writes, a value the key already
 * had included.
 */
export function setValue<S extends PropertyState>(
  state: S,
  page: string,
  key: string,
  value: string | undefined,
): S {
  const titles = spell(state.titles, [page, key]);
  const at = canonicalize(page);
  const held = map.get(state.properties, at) ?? map.empty<string>();
  if (value !== undefined) {
    const next = map.put(held, canonicalize(key), value);
    return { ...state, titles, properties: map.put(state.properties, at, next) };
  }
  if (!map.has(held, canonicalize(key))) {
    return titles === state.titles ? state : { ...state, titles };
  }
  const next = map.remove(held, canonicalize(key));
  const properties = next.size === 0 ? map.remove(state.properties, at) : map.put(state.properties, at, next);
  return { ...state, titles, properties };
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
  const held = map.get(state.properties, canonicalize(page)) ?? map.empty<string>();
  return [...map.entries(held)]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => ({ key: titleOf(state, key), value }));
}

/** Every title the properties name: each page that has one, and each key. */
export function* named(state: PropertyState): Generator<string> {
  for (const [page, held] of map.entries(state.properties)) {
    yield page;
    yield* map.keys(held);
  }
}
