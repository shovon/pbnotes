/**
 * The property slice put together from its events (#238): the fold, the
 * version table, the undo table, and the prediction, which folds with them.
 * Imports every event module, and is imported by none of them.
 */
import { canonicalize } from "../../canonicalize/canonicalize.ts";
import { from as fromPairs } from "../../immutable/immutable.ts";
import { each } from "../batch/batch.ts";
import type { EventOf } from "../../over/over.ts";
import { PROPERTY, getProperties } from "../../properties/properties.ts";
import type { Property, PropertyState } from "../../properties/properties.ts";
import { PROPERTY_SET } from "./set/set.ts";
import { PROPERTY_REMOVED } from "./removed/removed.ts";

/** Every property event. A new one is a module, and a line here. */
const EVENTS = [PROPERTY_SET, PROPERTY_REMOVED] as const;

const PROPERTIES = PROPERTY.slice(EVENTS);

/** Every event this slice folds, and its payload: read off `EVENTS`, so it cannot drift. */
export type PropertyEvent = EventOf<(typeof EVENTS)[number]>;

/**
 * Event type → the payload `v` this build folds and writes. The property half
 * of `HANDLES`; the gate that reads it is `graphFold`.
 */
export const PROPERTY_HANDLES = PROPERTIES.handles;

/** How to undo each property event: the property part of `UNDO`. */
export const PROPERTY_UNDO = PROPERTIES.undo;

/**
 * Whether `event` is a property event this fold reads: one of its types, well
 * formed. A batch asks it of every event it holds before it folds any (#225).
 */
export const reads = PROPERTIES.reads;

/**
 * The property fold: one event in, the state out. Hands back `state` itself
 * for any event that is not a well-formed property event.
 */
export const reduce = PROPERTIES.reduce;

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
  const held = fromPairs(properties.map(({ key, value }): [string, string] => [canonicalize(key), value]));
  let state: PropertyState = {
    properties: held.size === 0 ? fromPairs([]) : fromPairs([[at, held]]),
    titles: fromPairs([
      [at, page],
      ...properties.map(({ key }): [string, string] => [canonicalize(key), key]),
    ]),
  };
  for (const event of each(events)) state = reduce(state, event);
  return getProperties(state, page);
}
