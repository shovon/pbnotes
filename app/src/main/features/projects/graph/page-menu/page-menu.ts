import type { PageMenuOffer } from "../../../../../shared/graph";

/**
 * A page menu's offer as it crossed the bridge. The menu itself is in
 * `graph-ipc.ts`. Read leniently, like the block menu's: anything that does
 * not say `delete: true` leaves Delete Page… listed but disabled, which is
 * the harmless way to be wrong.
 */
export function readOffer(offer: unknown): PageMenuOffer {
  if (typeof offer !== "object" || offer === null) return {};
  return (offer as Record<string, unknown>).delete === true ? { delete: true } : {};
}
