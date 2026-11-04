/**
 * Undoing alias events (#233): each is undone by the other, and a step that
 * wrote one still holds while the page has or lacks the alias as it left it.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { NAMESPACE, stringOf } from "../events/events.ts";
import type { Batched } from "../batch/batch.ts";
import { same } from "../undo/undo.ts";
import type { Check, Undo } from "../undo/undo.ts";
import { aliasAdded, aliasRemoved } from "./aliases.ts";
import type { AliasEvent, AliasState } from "./aliases.ts";

/** Whether `page` answers to `alias`. */
function has(state: AliasState, page: string, alias: string): boolean {
  return state.aliases.get(canonicalize(page))?.has(canonicalize(alias)) ?? false;
}

/** The other event, unless the page already had what this one says. */
function inverse(state: AliasState, { type, payload }: Batched): Batched[] {
  const page = stringOf(payload, "page");
  const alias = stringOf(payload, "alias");
  const had = has(state, page, alias);
  if (had === (type === `${NAMESPACE}alias.added`)) return [];
  return [had ? aliasAdded(page, alias) : aliasRemoved(page, alias)];
}

/** Whether the page has the alias. */
function touched(_: AliasState, { payload }: Batched): Check<AliasState>[] {
  const page = stringOf(payload, "page");
  const alias = stringOf(payload, "alias");
  return [same((it) => has(it, page, alias))];
}

/** How to undo each alias event. Keyed on `AliasEvent['type']`, so none is missed. */
export const ALIAS_UNDO: Record<AliasEvent["type"], Undo<AliasState>> = {
  [`${NAMESPACE}alias.added`]: { inverse, touched },
  [`${NAMESPACE}alias.removed`]: { inverse, touched },
};
