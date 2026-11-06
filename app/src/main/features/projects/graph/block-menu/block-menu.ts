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
  const { delete: remove, count, reference } = offer as Record<string, unknown>;
  // Only a plain `false` hides it: anything else leaves the one item every
  // block's menu has always had.
  const hidden = reference === false ? { reference: false } : {};
  if (remove !== true) return hidden;
  // A count is only for several: one, or anything not a whole number, is
  // the block alone.
  const several = Number.isSafeInteger(count) && (count as number) > 1;
  return several
    ? { ...hidden, delete: true, count: count as number }
    : { ...hidden, delete: true };
}

/** What the cut item says (#246): the block alone, or how many go, as for delete. */
export function cutLabel(offer: BlockMenuOffer): string {
  return offer.count ? `Cut ${offer.count} Blocks` : "Cut Block";
}

/** What the delete item says: the block alone, or how many go. */
export function deleteLabel(offer: BlockMenuOffer): string {
  return offer.count ? `Delete ${offer.count} Blocks` : "Delete Block";
}
