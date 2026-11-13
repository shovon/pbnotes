/**
 * Whether an alias does what it says (#383): opens the page that holds it.
 * Read through `resolve`, never stored, so it is the same question for an
 * alias the page holds and one being typed, which is asked as if it were
 * held.
 *
 * An alias that does not open its page is inert, and says why, by the rule
 * that decides the name instead. What a window draws for each is its own.
 */
import * as map from "../../immutable/immutable.ts";
import * as set from "../../immutable/set.ts";
import { setAlias } from "../../aliases/aliases.ts";
import { canonicalize } from "../../titles/canonicalize.ts";
import { titleOf } from "../../titles/titles.ts";
import { resolver } from "../resolve.ts";
import type { Holds } from "../resolve.ts";

/** Why an alias does not open the page that holds it. */
export type Inert =
  /** It is the page's own title. */
  | { why: "self" }
  /** Rule 1: the name has blocks, properties, tags or an icon of its own. */
  | { why: "own" }
  /** Rule 2: the name is a date name, and opens its day, as it shows. */
  | { why: "day"; day: string }
  /** Rule 3: the name is a `YYYY-MM-DD`, the day itself. */
  | { why: "date" }
  /** Rule 4: the name has aliases of its own. */
  | { why: "aliases" }
  /** Rule 5: another page claims it too and sorts first; that page, as it shows. */
  | { why: "claimed"; by: string };

/** An alias a page holds, as it shows, and why it is inert, if it is. */
export type HeldAlias = { alias: string; inert?: Inert };

/**
 * Why `alias` would not open the page `page` opens, were that page to hold
 * it, or undefined when it would. For an alias the page holds already, the
 * same about the state as it stands.
 */
export function aliasing(state: Holds, page: string, alias: string): Inert | undefined {
  const names = resolver(state);
  const at = names.key(page);
  if (canonicalize(alias) === at) return { why: "self" };
  const held = setAlias(state, { page: titleOf(state, at), alias }, true);
  const after = resolver(held);
  const opens = after.key(alias);
  if (opens === at) return undefined;
  switch (after.rule(alias)) {
    case 1:
      return { why: "own" };
    case 2:
      return { why: "day", day: titleOf(held, opens) };
    case 3:
      return { why: "date" };
    case 4:
      return { why: "aliases" };
    default:
      return { why: "claimed", by: titleOf(held, opens) };
  }
}

/**
 * Every alias the page `page` opens holds, in effect or not, each spelt by
 * `titleOf` and ordered by `canonicalize`, since the set has no order of its
 * own. What the page's header draws: those in effect, and the rest dimmed.
 */
export function getHeldAliases(state: Holds, page: string): HeldAlias[] {
  const at = resolver(state).key(page);
  const keys = [...set.values(map.get(state.aliases, at) ?? set.empty())].sort();
  return keys.map((key) => {
    const inert = aliasing(state, at, key);
    const alias = titleOf(state, key);
    return inert === undefined ? { alias } : { alias, inert };
  });
}
