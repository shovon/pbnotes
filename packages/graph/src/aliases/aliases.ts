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
 * This file holds what both alias events share: the state, the payload, and
 * how a page gains or loses an alias. Each event is its own module
 * (`added/`, `removed/`), and `slice.ts` puts them together (#238).
 *
 * Nothing here reads blocks, properties or tags, and nothing in those folds
 * reads this.
 */

import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field } from "../events/events.ts";
import { over } from "../over/over.ts";
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

/** `define` and `slice` for the alias events. */
export const ALIAS = over<AliasState>();

// ── The payload both events share ───────────────────────────────────────────

/** `page` answers to `alias`. */
export type AliasAdded = { page: string; alias: string };

/** `page` no longer answers to `alias`. */
export type AliasRemoved = { page: string; alias: string };

/** A string field that is not blank once trimmed, or undefined. */
function title(payload: object, name: string): string | undefined {
  const value = field(payload, name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * An alias payload as this build reads it, or undefined when it is
 * malformed: not an object, or a `page` or `alias` that is not a string or is
 * blank once trimmed. Malformed is skipped whole. Any field beyond these is
 * ignored.
 */
export function readAlias(payload: unknown): AliasAdded | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = title(payload, "page");
  const alias = title(payload, "alias");
  return page && alias ? { page, alias } : undefined;
}

// ── Gaining and losing an alias ─────────────────────────────────────────────

/** Whether `page` answers to `alias`. */
export function answersTo(state: AliasState, page: string, alias: string): boolean {
  return state.aliases.get(canonicalize(page))?.has(canonicalize(alias)) ?? false;
}

/**
 * `state` with `page` answering to `alias` when `on`, and not when not. Both
 * names are spelled either way. Pure, and never changes what it is handed:
 * adding an alias the page has, or removing one it lacks, hands back `state`
 * itself unless a spelling is new.
 */
export function setAlias<S extends AliasState>(state: S, it: AliasAdded, on: boolean): S {
  const { page, alias } = it;
  const titles = spell(state.titles, [page, alias]);
  if (answersTo(state, page, alias) === on) {
    return titles === state.titles ? state : { ...state, titles };
  }
  const at = canonicalize(page);
  const next = new Set(state.aliases.get(at));
  if (on) next.add(canonicalize(alias));
  else next.delete(canonicalize(alias));
  const aliases = new Map(state.aliases);
  if (next.size === 0) aliases.delete(at);
  else aliases.set(at, next);
  return { ...state, titles, aliases };
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
