/**
 * `alias.added`: `page` answers to `alias`. Everything about the event, from
 * reading its payload to undoing it (#238).
 */
import { namespaced } from "../../event/event.ts";
import type { Named } from "../../event/event.ts";
import type { Written } from "../../event/over.ts";
import { same } from "../../undo/undo.ts";
import { ALIAS, answersTo, readAlias, setAlias } from "../aliases.ts";
import type { AliasAdded } from "../aliases.ts";
import { aliasRemoved } from "../removed/removed.ts";

export const ALIAS_ADDED = ALIAS.define({
  type: namespaced("alias.added"),
  v: 1,
  parse: readAlias,
  apply: (state, it) => setAlias(state, it, true),
  undo: {
    // Removed again, unless the page already answered to it.
    inverse: (state, it) =>
      answersTo(state, it.page, it.alias) ? [] : [aliasRemoved(it.page, it.alias)],
    touched: (_, it) => [same((now) => answersTo(now, it.page, it.alias))],
  },
});

/** The `alias.added` event: `page` answers to `alias`. */
export function aliasAdded(page: string, alias: string): Written<Named<"alias.added">, AliasAdded> {
  return ALIAS_ADDED.build({ page, alias });
}
