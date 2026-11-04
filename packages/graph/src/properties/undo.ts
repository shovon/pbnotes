/**
 * Undoing property events (#233): the inverse of each, and what a step that
 * wrote one must still find to be undone.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { NAMESPACE, stringOf } from "../events/events.ts";
import type { Batched } from "../batch/batch.ts";
import { same } from "../undo/undo.ts";
import type { Check, Undo } from "../undo/undo.ts";
import { propertyRemoved, propertySet } from "./properties.ts";
import type { PropertyEvent, PropertyState } from "./properties.ts";

/** `page`'s value for `key`, or undefined for none. */
function valueOf(state: PropertyState, page: string, key: string): string | undefined {
  return state.properties.get(canonicalize(page))?.get(canonicalize(key));
}

/** Back to the value `page`'s `key` had, or removed if it had none. */
function inverse(state: PropertyState, { type, payload }: Batched): Batched[] {
  const page = stringOf(payload, "page");
  const key = stringOf(payload, "key");
  const was = valueOf(state, page, key);
  const now = type === `${NAMESPACE}property.set` ? stringOf(payload, "value") : undefined;
  if (was === now) return [];
  return [was === undefined ? propertyRemoved(page, key) : propertySet(page, key, was)];
}

/** The page's value for that key. */
function touched(_: PropertyState, { payload }: Batched): Check<PropertyState>[] {
  const page = stringOf(payload, "page");
  const key = stringOf(payload, "key");
  return [same((it) => valueOf(it, page, key))];
}

/** How to undo each property event. Keyed on `PropertyEvent['type']`, so none is missed. */
export const PROPERTY_UNDO: Record<PropertyEvent["type"], Undo<PropertyState>> = {
  [`${NAMESPACE}property.set`]: { inverse, touched },
  [`${NAMESPACE}property.removed`]: { inverse, touched },
};
