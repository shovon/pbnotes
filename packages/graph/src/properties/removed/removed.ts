/**
 * `property.removed`: `page` no longer has `key`. Everything about the event,
 * from reading its payload to undoing it (#238).
 */
import { namespaced } from "../../event/event.ts";
import type { Named } from "../../event/event.ts";
import type { Written } from "../../event/over.ts";
import { same } from "../../undo/undo.ts";
import { PROPERTY, readKey, setValue, valueOf } from "../properties.ts";
import type { PropertyRemoved } from "../properties.ts";
import { propertySet } from "../set/set.ts";

export const PROPERTY_REMOVED = PROPERTY.define({
  type: namespaced("property.removed"),
  v: 1,
  parse: readKey,
  apply: (state, { page, key }) => setValue(state, page, key, undefined),
  undo: {
    // Set back to the value it had, unless the page already lacked it.
    inverse: (state, { page, key }) => {
      const was = valueOf(state, page, key);
      return was === undefined ? [] : [propertySet(page, key, was)];
    },
    touched: (_, { page, key }) => [same((now) => valueOf(now, page, key))],
  },
});

/** The `property.removed` event: `page` no longer has `key`. */
export function propertyRemoved(
  page: string,
  key: string,
): Written<Named<"property.removed">, PropertyRemoved> {
  return PROPERTY_REMOVED.build({ page, key });
}
