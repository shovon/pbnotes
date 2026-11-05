import type { BlockMenuOffer } from "../../../../../shared/graph";

/**
 * A block menu's offer as it crossed the bridge. The menu itself is in
 * `graph-ipc.ts`. Read leniently: an item that does not parse is not
 * offered, and the menu still opens with what does. A menu that shows less
 * than it might is harmless; one that never opens is a right-click that did
 * nothing.
 */
export function readOffer(offer: unknown): BlockMenuOffer {
  if (typeof offer !== "object" || offer === null) return {};
  const { delete: remove, count } = offer as Record<string, unknown>;
  if (remove !== true) return {};
  // A count is only for several: one, or anything not a whole number, is
  // the block alone.
  const several = Number.isSafeInteger(count) && (count as number) > 1;
  return several ? { delete: true, count: count as number } : { delete: true };
}

/** What the delete item says: the block alone, or how many go. */
export function deleteLabel(offer: BlockMenuOffer): string {
  return offer.count ? `Delete ${offer.count} Blocks` : "Delete Block";
}
