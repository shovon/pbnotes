/**
 * `tag.added`: `page` now points to `tag`. Everything about the event, from
 * reading its payload to undoing it (#238).
 */
import { namespaced } from "../../events.ts";
import type { Named } from "../../events.ts";
import type { Written } from "../../../over/over.ts";
import { same } from "../../../undo/undo.ts";
import { TAG, pointsTo, readTag, setTag } from "../../../tags/tags.ts";
import type { TagAdded } from "../../../tags/tags.ts";
import { tagRemoved } from "../removed/removed.ts";

export const TAG_ADDED = TAG.define({
  type: namespaced("tag.added"),
  v: 1,
  parse: readTag,
  apply: (state, it) => setTag(state, it, true),
  undo: {
    // Removed again, unless the page already pointed to it.
    inverse: (state, it) => (pointsTo(state, it.page, it.tag) ? [] : [tagRemoved(it.page, it.tag)]),
    touched: (_, it) => [same((now) => pointsTo(now, it.page, it.tag))],
  },
});

/** The `tag.added` event: `page` now points to `tag`. */
export function tagAdded(page: string, tag: string): Written<Named<"tag.added">, TagAdded> {
  return TAG_ADDED.build({ page, tag });
}
