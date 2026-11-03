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
 * The pages that point to `tag`. Empty for a page nothing tags. `also`:
 * other names a tag may use for it, as an alias does (#221).
 *
 * ponytail: walks every page's tags per call. Ask it for one page at a time.
 */
export function getTaggedBy(state: TagState, tag: string, also: Iterable<string> = []): string[] {
  const to = new Set([canonicalize(tag), ...[...also].map(canonicalize)]);
  const by = [...state.tags]
    .filter(([, held]) => [...held].some((it) => to.has(it)))
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
  for (const held of state.tags.values()) {
    for (const tag of new Set([...held].map(to))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/**
 * `page`'s tags as they will stand once `events` are recorded: a view's
 * writes still in flight, folded over the tags main last sent for it. A
 * guess, thrown away as each write settles.
 *
 * Folded with `reduce`, so what is drawn is what will be recorded. Both events
 * are safe to fold twice, so one the tags already show changes nothing. Any
 * event that is not a tag event on `page` is passed over.
 */
export function predictTags(
  tags: readonly string[],
  page: string,
  events: readonly { type: string; payload: unknown }[],
): string[] {
  if (events.length === 0) return [...tags];
  const at = canonicalize(page);
  const held = new Set(tags.map(canonicalize));
  let state: TagState = {
    tags: held.size === 0 ? new Map() : new Map([[at, held]]),
    titles: new Map([
      [at, page],
      ...tags.map((tag): [string, string] => [canonicalize(tag), tag]),
    ]),
  };
  for (const event of events) state = reduce(state, event);
  return getTags(state, page);
}

/** Every title the tags name: each page that has one, and each tag. */
export function* named(state: TagState): Generator<string> {
  for (const [page, held] of state.tags) {
    yield page;
    yield* held;
  }
}
