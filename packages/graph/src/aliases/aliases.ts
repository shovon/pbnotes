/**
 * Page aliases: other names a page answers to. The event schema, the fold and
 * the builders. What a name opens, aliases and built-in date names together,
 * is `resolve`; this slice only holds what the events said.
 *
 * An alias is a page title, compared through `canonicalize` like any other,
 * so giving `JavaScript` the alias `JS` names two pages, `JavaScript` and
 * `JS`. Naming is all the fold does: whether `JS` opens `JavaScript` is read
 * later, so removing an alias undoes everything it did at once.
 *
 * Nothing here reads blocks, properties or tags, and nothing in those folds
 * reads this.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field, NAMESPACE, unnamed } from "../events/events.ts";
import type { Named } from "../events/events.ts";
import { spell } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";

/**
 * What the alias fold reads and writes: `canonicalize(page)` → the
 * `canonicalize`d names it answers to. A page with no aliases has no entry,
 * never an empty one. The spelling of every page and alias is in `titles`.
 *
 * `Map` and `Set`, so `__proto__` is an ordinary page or alias (#62), and the
 * state survives the structured clone to the renderer (#146).
 */
export type AliasState = {
  readonly aliases: Map<string, Set<string>>;
  readonly titles: Titles;
};

// ── The events ──────────────────────────────────────────────────────────────

/** `page` answers to `alias`. */
export type AliasAdded = { page: string; alias: string };

/** `page` no longer answers to `alias`. */
export type AliasRemoved = { page: string; alias: string };

/** Every event this fold understands, and its payload. */
export type AliasEvent =
  | { type: Named<"alias.added">; payload: AliasAdded }
  | { type: Named<"alias.removed">; payload: AliasRemoved };

/** An `AliasEvent` with the namespace off its type. */
type Bare<E = AliasEvent> = E extends {
  type: `${typeof NAMESPACE}${infer T}`;
  payload: infer P;
}
  ? { type: T; payload: P }
  : never;

/**
 * Event type → the payload `v` this build folds and writes. The alias part of
 * `HANDLES`; the gate that reads it is `graphFold`.
 */
export const ALIAS_HANDLES: Record<AliasEvent["type"], number> = {
  [`${NAMESPACE}alias.added`]: 1,
  [`${NAMESPACE}alias.removed`]: 1,
};

// ── The fold: parse, then apply ─────────────────────────────────────────────

/** A string field that is not blank once trimmed, or undefined. */
function title(payload: object, name: string): string | undefined {
  const value = field(payload, name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * An alias event as this build reads it, or undefined for anything else: not
 * one of ours, or malformed. Malformed is skipped whole. Any field the
 * payload has beyond these is ignored.
 */
function parse(event: { type: string; payload: unknown }): Bare | undefined {
  const name = unnamed(event.type);
  if (name !== "alias.added" && name !== "alias.removed") return undefined;
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = title(payload, "page");
  const alias = title(payload, "alias");
  return page && alias ? { type: name, payload: { page, alias } } : undefined;
}

/** One parsed event applied. Pure, and never changes what it is handed. */
function apply<S extends AliasState>(state: S, it: Bare): S {
  const { page, alias } = it.payload;
  const titles = spell(state.titles, [page, alias]);
  const at = canonicalize(page);
  const to = canonicalize(alias);
  const held = state.aliases.get(at);
  const has = held?.has(to) ?? false;

  // Adding an alias the page has, or removing one it lacks, changes nothing.
  if (has === (it.type === "alias.added")) {
    return titles === state.titles ? state : { ...state, titles };
  }
  const next = new Set(held);
  if (it.type === "alias.added") next.add(to);
  else next.delete(to);
  const aliases = new Map(state.aliases);
  if (next.size === 0) aliases.delete(at);
  else aliases.set(at, next);
  return { ...state, titles, aliases };
}

/**
 * The alias fold: one event in, the state out. Hands back `state` itself for
 * any event that is not a well-formed alias event, or one that changes
 * nothing.
 */
export function reduce<S extends AliasState>(
  state: S,
  event: { type: string; payload: unknown },
): S {
  const parsed = parse(event);
  return parsed ? apply(state, parsed) : state;
}

// ── Builders ────────────────────────────────────────────────────────────────

/** One event as it is written, with the `v` the gate reads. */
type Built<T extends Bare["type"]> = Extract<AliasEvent, { type: Named<T> }> & { v: number };

function build<T extends Bare["type"]>(name: T, page: string, alias: string): Built<T> {
  const type = `${NAMESPACE}${name}` as Named<T>;
  return { v: ALIAS_HANDLES[type], type, payload: { page, alias } } as Built<T>;
}

/** The `alias.added` event: `page` answers to `alias`. */
export function aliasAdded(page: string, alias: string): Built<"alias.added"> {
  return build("alias.added", page, alias);
}

/** The `alias.removed` event: `page` no longer answers to `alias`. */
export function aliasRemoved(page: string, alias: string): Built<"alias.removed"> {
  return build("alias.removed", page, alias);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * `canonicalize(alias)` → the `canonicalize`d pages that claim it, A to Z by
 * key. Built in one pass, for whoever resolves many names against one state.
 */
export function claims(state: AliasState): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const [page, held] of state.aliases) {
    for (const alias of held) by.set(alias, [...(by.get(alias) ?? []), page]);
  }
  for (const pages of by.values()) pages.sort();
  return by;
}

/** Every title the aliases name: each page that has one, and each alias. */
export function* named(state: AliasState): Generator<string> {
  for (const [page, held] of state.aliases) {
    yield page;
    yield* held;
  }
}
