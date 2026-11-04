/**
 * Undoing tag events (#233): each is undone by the other, and a step that
 * wrote one still holds while the page has or lacks the tag as it left it.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { NAMESPACE, stringOf } from "../events/events.ts";
import type { Batched } from "../batch/batch.ts";
import { same } from "../undo/undo.ts";
import type { Check, Undo } from "../undo/undo.ts";
import { tagAdded, tagRemoved } from "./tags.ts";
import type { TagEvent, TagState } from "./tags.ts";

/** Whether `page` points to `tag`. */
function has(state: TagState, page: string, tag: string): boolean {
  return state.tags.get(canonicalize(page))?.has(canonicalize(tag)) ?? false;
}

/** The other event, unless the page already had what this one says. */
function inverse(state: TagState, { type, payload }: Batched): Batched[] {
  const page = stringOf(payload, "page");
  const tag = stringOf(payload, "tag");
  const had = has(state, page, tag);
  if (had === (type === `${NAMESPACE}tag.added`)) return [];
  return [had ? tagAdded(page, tag) : tagRemoved(page, tag)];
}

/** Whether the page has the tag. */
function touched(_: TagState, { payload }: Batched): Check<TagState>[] {
  const page = stringOf(payload, "page");
  const tag = stringOf(payload, "tag");
  return [same((it) => has(it, page, tag))];
}

/** How to undo each tag event. Keyed on `TagEvent['type']`, so none is missed. */
export const TAG_UNDO: Record<TagEvent["type"], Undo<TagState>> = {
  [`${NAMESPACE}tag.added`]: { inverse, touched },
  [`${NAMESPACE}tag.removed`]: { inverse, touched },
};
