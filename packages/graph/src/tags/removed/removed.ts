/**
 * `tag.removed`: `page` no longer points to `tag`. Everything about the
 * event, from reading its payload to undoing it (#238).
 */
import { namespaced } from "../../events/events.ts";
import type { Named } from "../../events/events.ts";
import type { Written } from "../../over/over.ts";
import { same } from "../../undo/undo.ts";
import { TAG, pointsTo, readTag, setTag } from "../tags.ts";
import type { TagRemoved } from "../tags.ts";
import { tagAdded } from "../added/added.ts";

export const TAG_REMOVED = TAG.define({
  type: namespaced("tag.removed"),
  v: 1,
  parse: readTag,
  apply: (state, it) => setTag(state, it, false),
  undo: {
    // Added back, unless the page already lacked it.
    inverse: (state, it) => (pointsTo(state, it.page, it.tag) ? [tagAdded(it.page, it.tag)] : []),
    touched: (_, it) => [same((now) => pointsTo(now, it.page, it.tag))],
  },
});

/** The `tag.removed` event: `page` no longer points to `tag`. */
export function tagRemoved(page: string, tag: string): Written<Named<"tag.removed">, TagRemoved> {
  return TAG_REMOVED.build({ page, tag });
}
