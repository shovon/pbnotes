/**
 * `icon.set`: `page`'s icon is now `icon`. Everything about the event, from
 * reading its payload to undoing it (#322).
 */
import { field, namespaced } from "../../events.ts";
import type { Named } from "../../events.ts";
import type { Written } from "../../../over/over.ts";
import { same } from "../../../undo/undo.ts";
import { ICON, iconOf, readPage, withIcon } from "../../../icons/icons.ts";
import type { IconSet } from "../../../icons/icons.ts";
import { iconRemoved } from "../removed/removed.ts";

export const ICON_SET = ICON.define({
  type: namespaced("icon.set"),
  v: 1,
  // The page, and an icon that is a string: "" is an icon. What it means is
  // the reader's, so nothing more is checked.
  parse: (payload): IconSet | undefined => {
    const at = readPage(payload);
    const icon = at && field(payload as object, "icon");
    return at && typeof icon === "string" ? { ...at, icon } : undefined;
  },
  apply: (state, { page, icon }) => withIcon(state, page, icon),
  undo: {
    // Back to the icon the page had, or removed if it had none.
    inverse: (state, { page, icon }) => {
      const was = iconOf(state, page);
      if (was === icon) return [];
      return [was === undefined ? iconRemoved(page) : iconSet(page, was)];
    },
    touched: (_, { page }) => [same((now) => iconOf(now, page))],
  },
});

/** The `icon.set` event: `page`'s icon is now `icon`. */
export function iconSet(page: string, icon: string): Written<Named<"icon.set">, IconSet> {
  return ICON_SET.build({ page, icon });
}
