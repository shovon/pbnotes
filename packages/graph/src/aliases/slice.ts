/**
 * The alias slice put together from its events (#238): the fold, the version
 * table, the undo table, and the prediction, which folds with them. Imports every event module, and is imported by
 * none of them.
 */
import { canonicalize } from "../titles/canonicalize.ts";
import { titleOf } from "../titles/titles.ts";
import * as map from "../immutable/immutable.ts";
import { from as fromPairs } from "../immutable/immutable.ts";
import * as set from "../immutable/set.ts";
import { each } from "../batch/batch.ts";
import type { EventOf } from "../event/over.ts";
import { ALIAS } from "./aliases.ts";
import type { AliasState } from "./aliases.ts";
import { ALIAS_ADDED } from "./added/added.ts";
import { ALIAS_REMOVED } from "./removed/removed.ts";

/** Every alias event. A new one is a module, and a line here. */
const EVENTS = [ALIAS_ADDED, ALIAS_REMOVED] as const;

const ALIASES = ALIAS.slice(EVENTS);

/** Every event this slice folds, and its payload: read off `EVENTS`, so it cannot drift. */
export type AliasEvent = EventOf<(typeof EVENTS)[number]>;

/**
 * Event type → the payload `v` this build folds and writes. The alias part of
 * `HANDLES`; the gate that reads it is `graphFold`.
 */
export const ALIAS_HANDLES = ALIASES.handles;

/** How to undo each alias event: the alias part of `UNDO`. */
export const ALIAS_UNDO = ALIASES.undo;

/**
 * Whether `event` is an alias event this fold reads: one of its types, well
 * formed. A batch asks it of every event it holds before it folds any (#225).
 */
export const reads = ALIASES.reads;

/**
 * The alias fold: one event in, the state out. Hands back `state` itself for
 * any event that is not a well-formed alias event, or one that changes
 * nothing.
 */
export const reduce = ALIASES.reduce;

/**
 * `page`'s aliases as they will stand once `events` are recorded: a view's
 * writes still in flight, folded over the aliases main last sent for it,
 * each as it shows, ordered by `canonicalize`. A guess, thrown away as each
 * write settles.
 *
 * Folded with `reduce`, so what is drawn is what will be recorded. Both events
 * are safe to fold twice, so one the aliases already show changes nothing. Any
 * event that is not an alias event on `page` is passed over. Whether an alias
 * is in effect is not guessed: that is main's to read.
 */
export function predictAliases(
  aliases: readonly string[],
  page: string,
  events: readonly { type: string; payload: unknown }[],
): string[] {
  if (events.length === 0) return [...aliases];
  const at = canonicalize(page);
  const held = set.from(aliases.map(canonicalize));
  let state: AliasState = {
    aliases: held.size === 0 ? fromPairs([]) : fromPairs([[at, held]]),
    titles: fromPairs([
      [at, page],
      ...aliases.map((alias): [string, string] => [canonicalize(alias), alias]),
    ]),
  };
  for (const event of each(events)) state = reduce(state, event);
  const now = map.get(state.aliases, at);
  return now === undefined ? [] : [...set.values(now)].sort().map((key) => titleOf(state, key));
}
