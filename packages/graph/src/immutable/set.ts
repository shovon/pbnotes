/**
 * A set of strings that is never changed (#371): a map whose every value is
 * `true`, so it is everything the map is. `add` and `remove` hand back a new
 * set and leave the one they were given as it was. Plain data, so it survives
 * a structured clone as itself, and `deepStrictEqual` compares two sets by
 * what they hold.
 *
 * Unordered: iterating goes in hash order, not the order things were added.
 * A reader that shows or picks by order sorts first.
 *
 * Knows nothing about what it holds.
 */
import * as map from "./immutable.ts";
import type { ImmutableMap } from "./immutable.ts";

export type ImmutableSet = ImmutableMap<true>;

/** The set with nothing in it. */
export function empty(): ImmutableSet {
  return map.empty();
}

export function has(set: ImmutableSet, item: string): boolean {
  return map.has(set, item);
}

/** The set with `item` in it: `set` itself when it already holds it. */
export function add(set: ImmutableSet, item: string): ImmutableSet {
  return map.put(set, item, true);
}

/** The set without `item`: `set` itself when it lacks it. */
export function remove(set: ImmutableSet, item: string): ImmutableSet {
  return map.remove(set, item);
}

/** Every item, in hash order. */
export function values(set: ImmutableSet): Generator<string> {
  return map.keys(set);
}

/** A set of `items`; an item given twice is held once. */
export function from(items: Iterable<string>): ImmutableSet {
  let set = empty();
  for (const item of items) set = add(set, item);
  return set;
}
