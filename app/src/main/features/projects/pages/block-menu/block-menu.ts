import type { BlockMenuOffer } from "../../../../../shared/pages";

/**
 * A block menu's offer as it crossed the bridge. The menu itself is in
 * `pages-ipc.ts`. Read leniently: an item that does not parse is not
 * offered, and the menu still opens with what does. A menu that shows less
 * than it might is harmless; one that never opens is a right-click that did
 * nothing.
 */
export function readOffer(offer: unknown): BlockMenuOffer {
  if (typeof offer !== "object" || offer === null) return {};
  return (offer as Record<string, unknown>).delete === true
    ? { delete: true }
    : {};
}
