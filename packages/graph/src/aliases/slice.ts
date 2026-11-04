/**
 * The alias slice put together from its events (#238): the fold, the version
 * table and the undo table. Imports every event module, and is imported by
 * none of them.
 */
import type { EventOf } from "../over/over.ts";
import { ALIAS } from "./aliases.ts";
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
