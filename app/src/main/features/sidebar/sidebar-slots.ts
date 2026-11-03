/**
 * The bench slots the sidebar (#184) keeps per project, each with the decoder
 * that guards what main stores. `index.ts` hands these to the bench; the
 * bench knows nothing about what they hold.
 */
import { SIDEBAR_SLOTS } from "../../../shared/sidebar.ts";
import type { SidebarState } from "../../../shared/sidebar.ts";
import type { Slot } from "../bench/bench.ts";

/** Generous beside the ten shown: a guard against a runaway list, not a rule. */
const MOST_PAGES = 100;

/** A list of titles, or nothing. */
export const recentPages: Slot<string[]> = {
  decode: (raw) =>
    Array.isArray(raw) &&
    raw.length <= MOST_PAGES &&
    raw.every((item) => typeof item === "string")
      ? [...raw]
      : undefined,
};

/** Whether it is collapsed, and nothing else that arrived with it. */
export const sidebar: Slot<SidebarState> = {
  decode: (raw) => {
    const collapsed = (raw as { collapsed?: unknown } | null)?.collapsed;
    return typeof collapsed === "boolean" ? { collapsed } : undefined;
  },
};

/** Every slot the sidebar keeps, by name, for `createOpenBench`. */
export const sidebarSlots = new Map<string, Slot<unknown>>([
  [SIDEBAR_SLOTS.recentPages, recentPages],
  [SIDEBAR_SLOTS.sidebar, sidebar],
]);
