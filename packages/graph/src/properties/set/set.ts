/**
 * `property.set`: `page`'s `key` is now `value`. Everything about the event,
 * from reading its payload to undoing it (#238).
 */
import { field, namespaced } from "../../events/events.ts";
import type { Named } from "../../events/events.ts";
import type { Written } from "../../over/over.ts";
import { same } from "../../undo/undo.ts";
import { PROPERTY, readKey, setValue, valueOf } from "../properties.ts";
import type { PropertySet } from "../properties.ts";
import { propertyRemoved } from "../removed/removed.ts";

export const PROPERTY_SET = PROPERTY.define({
  type: namespaced("property.set"),
  v: 1,
  // The page and key, and a value that is a string: "" is a value.
  parse: (payload): PropertySet | undefined => {
    const at = readKey(payload);
    const value = at && field(payload as object, "value");
    return at && typeof value === "string" ? { ...at, value } : undefined;
  },
  apply: (state, { page, key, value }) => setValue(state, page, key, value),
  undo: {
    // Back to the value the key had, or removed if it had none.
    inverse: (state, { page, key, value }) => {
      const was = valueOf(state, page, key);
      if (was === value) return [];
      return [was === undefined ? propertyRemoved(page, key) : propertySet(page, key, was)];
    },
    touched: (_, { page, key }) => [same((now) => valueOf(now, page, key))],
  },
});

/** The `property.set` event: `page`'s `key` is now `value`. */
export function propertySet(
  page: string,
  key: string,
  value: string,
): Written<Named<"property.set">, PropertySet> {
  return PROPERTY_SET.build({ page, key, value });
}
