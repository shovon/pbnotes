/**
 * The icon slice put together from its events (#322): the fold, the version
 * table, the undo table, and the prediction, which folds with them. Imports
 * every event module, and is imported by none of them.
 */
import { canonicalize } from "../../canonicalize/canonicalize.ts";
import { from as fromPairs } from "../../immutable/immutable.ts";
import { each } from "../batch/batch.ts";
import type { EventOf } from "../../over/over.ts";
import { ICON, iconOf } from "../../icons/icons.ts";
import type { IconState } from "../../icons/icons.ts";
import { ICON_SET } from "./set/set.ts";
import { ICON_REMOVED } from "./removed/removed.ts";

/** Every icon event. A new one is a module, and a line here. */
const EVENTS = [ICON_SET, ICON_REMOVED] as const;

const ICONS = ICON.slice(EVENTS);

/** Every event this slice folds, and its payload: read off `EVENTS`, so it cannot drift. */
export type IconEvent = EventOf<(typeof EVENTS)[number]>;

/**
 * Event type → the payload `v` this build folds and writes. The icon part of
 * `HANDLES`; the gate that reads it is `graphFold`.
 */
export const ICON_HANDLES = ICONS.handles;

/** How to undo each icon event: the icon part of `UNDO`. */
export const ICON_UNDO = ICONS.undo;

/**
 * Whether `event` is an icon event this fold reads: one of its types, well
 * formed. A batch asks it of every event it holds before it folds any (#225).
 */
export const reads = ICONS.reads;

/**
 * The icon fold: one event in, the state out. Hands back `state` itself for
 * any event that is not a well-formed icon event.
 */
export const reduce = ICONS.reduce;

/**
 * `page`'s icon as it will stand once `events` are recorded: a view's writes
 * still in flight, folded over the icon main last sent for it. A guess,
 * thrown away as each write settles.
 *
 * Folded with `reduce`, so what is drawn is what will be recorded. Both events
 * are safe to fold twice. Any event that is not an icon event on `page` is
 * passed over.
 */
export function predictIcon(
  icon: string | undefined,
  page: string,
  events: readonly { type: string; payload: unknown }[],
): string | undefined {
  if (events.length === 0) return icon;
  const at = canonicalize(page);
  let state: IconState = {
    icons: icon === undefined ? fromPairs([]) : fromPairs([[at, icon]]),
    titles: fromPairs([[at, page]]),
  };
  for (const event of each(events)) state = reduce(state, event);
  return iconOf(state, page);
}
