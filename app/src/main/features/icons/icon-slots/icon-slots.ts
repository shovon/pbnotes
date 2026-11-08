/**
 * The bench slot choosing a page's icon (#323) keeps per project, with the
 * decoder that guards what main stores. `index.ts` hands it to the bench;
 * the bench knows nothing about what it holds.
 */
import { ICON_SLOTS } from "../../../../shared/icons.ts";
import type { Slot } from "../../bench/bench.ts";

/** Generous beside the sixteen kept: a guard against a runaway list, not a rule. */
const MOST = 100;

/** An emoji is a few code points; anything longer than this is not one. */
const LONGEST = 64;

/** A list of short strings, or nothing. */
export const recentEmoji: Slot<string[]> = {
  decode: (raw) =>
    Array.isArray(raw) &&
    raw.length <= MOST &&
    raw.every((item) => typeof item === "string" && item.length <= LONGEST)
      ? [...raw]
      : undefined,
};

/** Every slot choosing an icon keeps, by name, for `createOpenBench`. */
export const iconSlots = new Map<string, Slot<unknown>>([[ICON_SLOTS.recentEmoji, recentEmoji]]);
