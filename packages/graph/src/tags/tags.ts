/**
 * Page tags: a page pointing at another page, and nothing else. The event
 * schema, the fold, the builders and the reads.
 *
 * A tag is a page title, compared through `canonicalize` like any other, so
 * tagging `Foo` with `Work` names two pages, `Foo` and `Work`. Naming is all
 * it does: a tag never creates a page. A page that only tags name stops being
 * one when the last of them goes, as a page that only a link names does.
 *
 * Nothing here reads blocks or properties, and nothing in those folds reads
 * this.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field, NAMESPACE, unnamed } from "../events/events.ts";
import type { Named } from "../events/events.ts";
import { spell, titleOf } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";

/**
 * What the tag fold reads and writes: `canonicalize(page)` → the
 * `canonicalize`d pages it points to. A page with no tags has no entry, never
 * an empty one. The spelling of every page and tag is in `titles`.
 *
 * `Map` and `Set`, so `__proto__` is an ordinary page or tag (#62), and the
 * state survives the structured clone to the renderer (#146).
 */
export type TagState = {
  readonly tags: Map<string, Set<string>>;
  readonly titles: Titles;
};

// ── The events ──────────────────────────────────────────────────────────────

/** `page` now points to `tag`. */
export type TagAdded = { page: string; tag: string };

/** `page` no longer points to `tag`. */
export type TagRemoved = { page: string; tag: string };

/** Every event this fold understands, and its payload. */
export type TagEvent =
  | { type: Named<"tag.added">; payload: TagAdded }
  | { type: Named<"tag.removed">; payload: TagRemoved };

/** A `TagEvent` with the namespace off its type. */
type Bare<E = TagEvent> = E extends {
  type: `${typeof NAMESPACE}${infer T}`;
  payload: infer P;
}
  ? { type: T; payload: P }
  : never;

/**
 * Event type → the payload `v` this build folds and writes. The tag part of
 * `HANDLES`; the gate that reads it is `graphFold`.
 */
export const TAG_HANDLES: Record<TagEvent["type"], number> = {
  [`${NAMESPACE}tag.added`]: 1,
  [`${NAMESPACE}tag.removed`]: 1,
};

// ── The fold: parse, then apply ─────────────────────────────────────────────

/** A string field that is not blank once trimmed, or undefined. */
function title(payload: object, name: string): string | undefined {
  const value = field(payload, name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * A tag event as this build reads it, or undefined for anything else: not one
 * of ours, or malformed. Malformed is skipped whole. Any field the payload has
 * beyond these is ignored.
 */
function parse(event: { type: string; payload: unknown }): Bare | undefined {
  const name = unnamed(event.type);
  if (name !== "tag.added" && name !== "tag.removed") return undefined;
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = title(payload, "page");
  const tag = title(payload, "tag");
  return page && tag ? { type: name, payload: { page, tag } } : undefined;
}

/** One parsed event applied. Pure, and never changes what it is handed. */
function apply<S extends TagState>(state: S, it: Bare): S {
  const { page, tag } = it.payload;
  const titles = spell(state.titles, [page, tag]);
  const at = canonicalize(page);
  const to = canonicalize(tag);
  const held = state.tags.get(at);
  const has = held?.has(to) ?? false;

  // Adding a tag the page has, or removing one it lacks, changes nothing.
  if (has === (it.type === "tag.added")) {
    return titles === state.titles ? state : { ...state, titles };
  }
  const next = new Set(held);
  if (it.type === "tag.added") next.add(to);
  else next.delete(to);
  const tags = new Map(state.tags);
  if (next.size === 0) tags.delete(at);
  else tags.set(at, next);
  return { ...state, titles, tags };
}

/**
 * The tag fold: one event in, the state out. Hands back `state` itself for
 * any event that is not a well-formed tag event, or one that changes nothing.
 */
export function reduce<S extends TagState>(
  state: S,
  event: { type: string; payload: unknown },
): S {
  const parsed = parse(event);
  return parsed ? apply(state, parsed) : state;
}

// ── Builders ────────────────────────────────────────────────────────────────

/** One event as it is written, with the `v` the gate reads. */
type Built<T extends Bare["type"]> = Extract<TagEvent, { type: Named<T> }> & { v: number };

function build<T extends Bare["type"]>(name: T, page: string, tag: string): Built<T> {
  const type = `${NAMESPACE}${name}` as Named<T>;
  return { v: TAG_HANDLES[type], type, payload: { page, tag } } as Built<T>;
}

/** The `tag.added` event: `page` now points to `tag`. */
export function tagAdded(page: string, tag: string): Built<"tag.added"> {
  return build("tag.added", page, tag);
}

/** The `tag.removed` event: `page` no longer points to `tag`. */
export function tagRemoved(page: string, tag: string): Built<"tag.removed"> {
  return build("tag.removed", page, tag);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** `keys`, each in the spelling it shows, ordered by key so every machine lists them alike. */
function shown(state: TagState, keys: Iterable<string>): string[] {
  return [...keys].sort().map((key) => titleOf(state, key));
}

/** The pages `page` points to. Empty for a page with no tags. */
export function getTags(state: TagState, page: string): string[] {
  return shown(state, state.tags.get(canonicalize(page)) ?? []);
}

/**
 * The pages that point to `tag`. Empty for a page nothing tags.
 *
 * ponytail: walks every page's tags per call. Ask it for one page at a time.
 */
export function getTaggedBy(state: TagState, tag: string): string[] {
  const to = canonicalize(tag);
  const by = [...state.tags].filter(([, held]) => held.has(to)).map(([page]) => page);
  return shown(state, by);
}

/** Every title the tags name: each page that has one, and each tag. */
export function* named(state: TagState): Generator<string> {
  for (const [page, held] of state.tags) {
    yield page;
    yield* held;
  }
}
