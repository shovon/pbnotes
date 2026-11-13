/**
 * `alias.removed`: `page` no longer answers to `alias`. Everything about the
 * event, from reading its payload to undoing it (#238).
 */
import { namespaced } from "../../event/event.ts";
import type { Named } from "../../event/event.ts";
import type { Written } from "../../event/over.ts";
import { same } from "../../undo/undo.ts";
import { ALIAS, answersTo, readAlias, setAlias } from "../aliases.ts";
import type { AliasRemoved } from "../aliases.ts";
import { aliasAdded } from "../added/added.ts";

export const ALIAS_REMOVED = ALIAS.define({
  type: namespaced("alias.removed"),
  v: 1,
  parse: readAlias,
  apply: (state, it) => setAlias(state, it, false),
  undo: {
    // Added back, unless the page already lacked it.
    inverse: (state, it) =>
      answersTo(state, it.page, it.alias) ? [aliasAdded(it.page, it.alias)] : [],
    touched: (_, it) => [same((now) => answersTo(now, it.page, it.alias))],
  },
});

/** The `alias.removed` event: `page` no longer answers to `alias`. */
export function aliasRemoved(
  page: string,
  alias: string,
): Written<Named<"alias.removed">, AliasRemoved> {
  return ALIAS_REMOVED.build({ page, alias });
}
