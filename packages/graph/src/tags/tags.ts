/**
 * Page tags: a page pointing at another page, and nothing else.
 *
 * A tag is a page title, compared through `canonicalize` like any other, so
 * tagging `Foo` with `Work` names two pages, `Foo` and `Work`. Naming is all
 * it does: a tag never creates a page. A page that only tags name stops being
 * one when the last of them goes, as a page that only a link names does.
 *
 * This file holds what both tag events share: the state, the payload, and
 * how a page gains or loses a tag. The events themselves are the folders
 * beside this file, one module each, and `slice.ts` is the list that puts
 * them together (#238).
 *
 * Nothing here reads blocks or properties, and nothing in those folds reads
 * this.
 */

import * as map from "../immutable/immutable.ts";
import type { ImmutableMap } from "../immutable/immutable.ts";
import * as set from "../immutable/set.ts";
import type { ImmutableSet } from "../immutable/set.ts";
import { canonicalize } from "../titles/canonicalize.ts";
import { field } from "../event/event.ts";
import { over } from "../event/over.ts";
import { spell, titleOf } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";

/**
 * What the tag fold reads and writes: `canonicalize(page)` → the
 * `canonicalize`d pages it points to. A page with no tags has no entry, never
 * an empty one. The spelling of every page and tag is in `titles`.
 *
 * An immutable map of immutable sets (#276, #371), so `__proto__` is an
 * ordinary page or tag (#62), a tag costs one path of one page's set, and
 * the state survives a structured clone (#146).
 */
export type TagState = {
  readonly tags: ImmutableMap<ImmutableSet>;
  readonly titles: Titles;
};

/** `define` and `slice` for the tag events. */
export const TAG = over<TagState>();

// ── The payload both events share ───────────────────────────────────────────

/** `page` now points to `tag`. */
export type TagAdded = { page: string; tag: string };

/** `page` no longer points to `tag`. */
export type TagRemoved = { page: string; tag: string };

/** A string field that is not blank once trimmed, or undefined. */
function title(payload: object, name: string): string | undefined {
  const value = field(payload, name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * A tag payload as this build reads it, or undefined when it is malformed:
 * not an object, or a `page` or `tag` that is not a string or is blank once
 * trimmed. Malformed is skipped whole. Any field beyond these is ignored.
 */
export function readTag(payload: unknown): TagAdded | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = title(payload, "page");
  const tag = title(payload, "tag");
  return page && tag ? { page, tag } : undefined;
}

// ── Gaining and losing a tag ────────────────────────────────────────────────

/** Whether `page` points to `tag`. */
export function pointsTo(state: TagState, page: string, tag: string): boolean {
  const held = map.get(state.tags, canonicalize(page));
  return held !== undefined && set.has(held, canonicalize(tag));
}

/**
 * `state` with `page` pointing to `tag` when `on`, and not when not. Both
 * names are spelled either way. Pure, and never changes what it is handed:
 * adding a tag the page has, or removing one it lacks, hands back `state`
 * itself unless a spelling is new.
 */
export function setTag<S extends TagState>(state: S, it: TagAdded, on: boolean): S {
  const { page, tag } = it;
  const titles = spell(state.titles, [page, tag]);
  if (pointsTo(state, page, tag) === on) {
    return titles === state.titles ? state : { ...state, titles };
  }
  const at = canonicalize(page);
  const held = map.get(state.tags, at) ?? set.empty();
  const next = on ? set.add(held, canonicalize(tag)) : set.remove(held, canonicalize(tag));
  const tags = next.size === 0 ? map.remove(state.tags, at) : map.put(state.tags, at, next);
  return { ...state, titles, tags };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** `keys`, each in the spelling it shows, ordered by key so every machine lists them alike. */
function shown(state: TagState, keys: Iterable<string>): string[] {
  return [...keys].sort().map((key) => titleOf(state, key));
}

/** The pages `page` points to. Empty for a page with no tags. */
export function getTags(state: TagState, page: string): string[] {
  const held = map.get(state.tags, canonicalize(page));
  return held === undefined ? [] : shown(state, set.values(held));
}

/**
 * The pages that point to `tag`. Empty for a page nothing tags. `also`:
 * other names a tag may use for it, as an alias does (#221).
 *
 * ponytail: walks every page's tags per call. Ask it for one page at a time.
 */
export function getTaggedBy(state: TagState, tag: string, also: Iterable<string> = []): string[] {
  const to = new Set([canonicalize(tag), ...[...also].map(canonicalize)]);
  const by = [...map.entries(state.tags)]
    .filter(([, held]) => [...to].some((it) => set.has(held, it)))
    .map(([page]) => page);
  return shown(state, by);
}

/**
 * `canonicalize(tag)` → how many pages point to it. A page nothing tags has
 * no entry. `to` takes a tag's key to the key of the page it counts for, as
 * resolving an alias does (#221); a page tagging two names of one page counts
 * once.
 */
export function countTaggedBy(
  state: TagState,
  to: (key: string) => string = (key) => key,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const held of map.values(state.tags)) {
    for (const tag of new Set([...set.values(held)].map(to))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/** Every title the tags name: each page that has one, and each tag. */
export function* named(state: TagState): Generator<string> {
  for (const [page, held] of map.entries(state.tags)) {
    yield page;
    yield* set.values(held);
  }
}
