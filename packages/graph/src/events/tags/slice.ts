/**
 * The tag slice put together from its events (#238): the fold, the version
 * table, the undo table, and the prediction, which folds with them. Imports
 * every event module, and is imported by none of them.
 */
import { canonicalize } from "../../canonicalize/canonicalize.ts";
import { from as fromPairs } from "../../immutable/immutable.ts";
import { each } from "../batch/batch.ts";
import type { EventOf } from "../../over/over.ts";
import { TAG, getTags } from "../../tags/tags.ts";
import type { TagState } from "../../tags/tags.ts";
import { TAG_ADDED } from "./added/added.ts";
import { TAG_REMOVED } from "./removed/removed.ts";

/** Every tag event. A new one is a module, and a line here. */
const EVENTS = [TAG_ADDED, TAG_REMOVED] as const;

const TAGS = TAG.slice(EVENTS);

/** Every event this slice folds, and its payload: read off `EVENTS`, so it cannot drift. */
export type TagEvent = EventOf<(typeof EVENTS)[number]>;

/**
 * Event type → the payload `v` this build folds and writes. The tag part of
 * `HANDLES`; the gate that reads it is `graphFold`.
 */
export const TAG_HANDLES = TAGS.handles;

/** How to undo each tag event: the tag part of `UNDO`. */
export const TAG_UNDO = TAGS.undo;

/**
 * Whether `event` is a tag event this fold reads: one of its types, well
 * formed. A batch asks it of every event it holds before it folds any (#225).
 */
export const reads = TAGS.reads;

/**
 * The tag fold: one event in, the state out. Hands back `state` itself for
 * any event that is not a well-formed tag event, or one that changes nothing.
 */
export const reduce = TAGS.reduce;

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
    titles: fromPairs([
      [at, page],
      ...tags.map((tag): [string, string] => [canonicalize(tag), tag]),
    ]),
  };
  for (const event of each(events)) state = reduce(state, event);
  return getTags(state, page);
}
