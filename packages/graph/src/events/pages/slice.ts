/**
 * The page slice put together from its events (#238, #108): the fold, the
 * version table and the undo table. Imports the event modules, and is
 * imported by none.
 *
 * A delete folds less than a rename does, so the slice is over what a rename
 * folds, which a delete takes as it is.
 */
import type { EventOf } from "../../over/over.ts";
import { over } from "../../over/over.ts";
import type { Holds } from "../../renames/renames.ts";
import { PAGE_DELETED } from "./deleted/deleted.ts";
import { PAGE_RENAMED } from "./renamed/renamed.ts";

/** Every page event. A new one is a module, and a line here. */
const EVENTS = [PAGE_DELETED, PAGE_RENAMED] as const;

const PAGES = over<Holds>().slice(EVENTS);

/** Every event this slice folds, and its payload: read off `EVENTS`, so it cannot drift. */
export type PagesEvent = EventOf<(typeof EVENTS)[number]>;

/**
 * Event type → the payload `v` this build folds and writes. The page part
 * of `HANDLES`; the gate that reads it is `graphFold`.
 */
export const PAGE_HANDLES = PAGES.handles;

/** How to undo a page event: the page part of `UNDO`. */
export const PAGE_UNDO = PAGES.undo;

/**
 * Whether `event` is a page event this fold reads: one of its types, well
 * formed. A batch asks it of every event it holds before it folds any (#225).
 */
export const reads = PAGES.reads;

/**
 * The page fold: a delete empties a page, a rename moves it. Hands back
 * `state` itself for any other event.
 */
export const reduce = PAGES.reduce;
