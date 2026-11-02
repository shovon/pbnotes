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

/**
 * Where the menu opens, in whole window pixels, which is what `popup` takes.
 * Anything that is not two finite numbers is undefined, and the menu opens
 * at the pointer instead: a menu in the wrong place still works, one that
 * never opens is a click that did nothing.
 */
export function readPoint(at: unknown): { x: number; y: number } | undefined {
  if (typeof at !== "object" || at === null) return undefined;
  const { x, y } = at as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.round(x), y: Math.round(y) };
}
