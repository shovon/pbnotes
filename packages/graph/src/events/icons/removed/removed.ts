/**
 * `icon.removed`: `page` has no icon. Everything about the event, from
 * reading its payload to undoing it (#322).
 */
import { namespaced } from "../../events.ts";
import type { Named } from "../../events.ts";
import type { Written } from "../../../over/over.ts";
import { same } from "../../../undo/undo.ts";
import { ICON, iconOf, readPage, withIcon } from "../../../icons/icons.ts";
import type { IconRemoved } from "../../../icons/icons.ts";
import { iconSet } from "../set/set.ts";

export const ICON_REMOVED = ICON.define({
  type: namespaced("icon.removed"),
  v: 1,
  parse: readPage,
  apply: (state, { page }) => withIcon(state, page, undefined),
  undo: {
    // Set back to the icon it had, unless the page already had none.
    inverse: (state, { page }) => {
      const was = iconOf(state, page);
      return was === undefined ? [] : [iconSet(page, was)];
    },
    touched: (_, { page }) => [same((now) => iconOf(now, page))],
  },
});

/** The `icon.removed` event: `page` has no icon. */
export function iconRemoved(page: string): Written<Named<"icon.removed">, IconRemoved> {
  return ICON_REMOVED.build({ page });
}
