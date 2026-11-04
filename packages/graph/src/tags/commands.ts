/**
 * Writing tags: a command per change, each checking the page's tags before it
 * builds and dispatches. The events are the builders in `tags.ts`; this is
 * what decides whether to write one.
 *
 * Every command refuses what the fold would skip, so nothing is written that
 * folds to nothing, and writes nothing for a change that changes nothing, so
 * the log does not collect events that mean nothing.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { getTags } from "./tags.ts";
import type { TagState } from "./tags.ts";
import type { TagEvent } from "../events/tags/slice.ts";
import { tagAdded } from "../events/tags/added/added.ts";
import { tagRemoved } from "../events/tags/removed/removed.ts";

/**
 * What the commands need: the state as it stands, and a way to append one of
 * this fold's events. `GraphView` is one.
 */
export type TagsView = {
  readonly state: TagState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: TagEvent["type"], payload: unknown): Promise<unknown>;
};

/** Whether `page` points to `tag` as the fold holds it. */
function has(state: TagState, page: string, tag: string): boolean {
  return state.tags.get(canonicalize(page))?.has(canonicalize(tag)) ?? false;
}

/** The fold's rule for a page or a tag: something, once trimmed. */
function requireName(name: string, what: string): void {
  if (name.trim() === "") throw new Error(`A tag needs a ${what}`);
}

/**
 * `page` now points to `tag`. A tag the page already has writes nothing.
 * Hands back the page's tags as they then stand.
 */
export async function addTag(view: TagsView, page: string, tag: string): Promise<string[]> {
  requireName(page, "page");
  requireName(tag, "tag");
  if (!has(view.state, page, tag)) {
    const event = tagAdded(page, tag);
    await view.dispatch(event.v, event.type, event.payload);
  }
  return getTags(view.state, page);
}

/**
 * `page` no longer points to `tag`. A tag the page does not have writes
 * nothing. Hands back the page's tags as they then stand.
 */
export async function removeTag(view: TagsView, page: string, tag: string): Promise<string[]> {
  requireName(page, "page");
  requireName(tag, "tag");
  if (has(view.state, page, tag)) {
    const event = tagRemoved(page, tag);
    await view.dispatch(event.v, event.type, event.payload);
  }
  return getTags(view.state, page);
}
