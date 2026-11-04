/**
 * The delete slice put together from its event (#238): the fold, the version
 * table and the undo table. Imports the event module, and is imported by
 * none.
 */
import type { EventOf } from "../over/over.ts";
import { DELETE } from "./deletes.ts";
import { PAGE_DELETED } from "./deleted/deleted.ts";

/** Every delete event. A new one is a module, and a line here. */
const EVENTS = [PAGE_DELETED] as const;

const DELETES = DELETE.slice(EVENTS);

/** Every event this slice folds, and its payload: read off `EVENTS`, so it cannot drift. */
export type DeleteEvent = EventOf<(typeof EVENTS)[number]>;

/**
 * Event type → the payload `v` this build folds and writes. The delete part
 * of `HANDLES`; the gate that reads it is `graphFold`.
 */
export const DELETE_HANDLES = DELETES.handles;

/** How to undo a page delete: the delete part of `UNDO`. */
export const DELETE_UNDO = DELETES.undo;

/**
 * Whether `event` is a page delete this fold reads: one of its types, well
 * formed. A batch asks it of every event it holds before it folds any (#225).
 */
export const reads = DELETES.reads;

/**
 * The delete fold: the page's blocks, properties, tags and aliases emptied at
 * its key. Hands back `state` itself for any other event.
 */
export const reduce = DELETES.reduce;
