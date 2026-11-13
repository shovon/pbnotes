/**
 * What a name opens (#221). A page answers to its title, to its built-in date
 * names if it is a day (`dateOf`), and to the aliases the events gave it.
 * This is where those meet; neither the alias fold nor the journal reads the
 * other.
 *
 * The order, first that applies:
 *
 * 1. **A name with a page of its own opens itself:** blocks, properties,
 *    tags or an icon of its own. Nothing is ever hidden behind another name.
 * 2. **A date name opens its day.**
 * 3. **A `YYYY-MM-DD` opens itself,** the day. No alias takes one over.
 * 4. **A name with aliases of its own opens itself.** One hop only, so
 *    nothing chains and nothing loops.
 * 5. **An alias opens the page that claims it.** Of two that claim one, the
 *    page whose key sorts first, the same on every machine. A page claiming
 *    it that is a date name, with no page of its own, is its day.
 * 6. Otherwise, itself.
 *
 * Read, never stored: removing an alias, or writing on a name, changes what
 * it opens at once, and no ledger needs a migration.
 */
import * as map from "../immutable/immutable.ts";
import * as set from "../immutable/set.ts";
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { DATE_PATTERN, dateOf, namesOf } from "../journal/journal.ts";
import { titleOf } from "../titles/titles.ts";
import { claims } from "../aliases/aliases.ts";
import type { AliasState } from "../aliases/aliases.ts";
import type { BlockState } from "../blocks/blocks.ts";
import * as forest from "../forest/forest.ts";
import type { PropertyState } from "../properties/properties.ts";
import type { TagState } from "../tags/tags.ts";
import type { IconState } from "../icons/icons.ts";

/** What resolving reads: whether a name has a page of its own, and the aliases. */
export type Holds = BlockState & PropertyState & TagState & AliasState & IconState;

/** Resolving against one state, with what it needs built once. */
export type Resolver = {
  /** The key (`canonicalize`) of the page `name` opens. */
  key(name: string): string;
  /** The page `name` opens, as it shows: `name` itself when it opens itself. */
  title(name: string): string;
  /** The page an alias in effect opens, as it shows, or undefined. */
  aliasOf(name: string): string | undefined;
  /** The keys of the aliases in effect on the page at `key`. */
  aliases(key: string): string[];
  /**
   * The keys of every name that opens the page at `key`: its own, its date
   * names if it is a day, and its aliases in effect. `key` first.
   */
  names(key: string): string[];
};

/** One resolver per state: states are never changed, only replaced. */
const made = new WeakMap<Holds, Resolver>();

/** Resolving against `state`. */
export function resolver(state: Holds): Resolver {
  const held = made.get(state);
  if (held) return held;

  let claimed: Map<string, string[]> | undefined;

  /** Rule 1: blocks, properties, tags or an icon of its own. Aliases are rule 4. */
  const own = (key: string) =>
    forest.rootsOf(state.forest, key).length > 0 ||
    (map.get(state.properties, key)?.size ?? 0) > 0 ||
    (map.get(state.tags, key)?.size ?? 0) > 0 ||
    map.has(state.icons, key);

  /** Whether rules 1 to 4 leave `key` to an alias. */
  const free = (key: string) =>
    !own(key) && dateOf(key) === undefined && !DATE_PATTERN.test(key) && !map.has(state.aliases, key);

  /** A page an alias opens, as rules 1 and 2 have it: a date name is its day. */
  const settle = (key: string) => (own(key) ? key : dateOf(key) ?? key);

  /** Rule 5 alone, for a key rules 1 to 4 pass over. */
  const claimant = (key: string): string | undefined => {
    claimed ??= claims(state);
    const by = claimed.get(key)?.find((page) => page !== key);
    return by === undefined ? undefined : settle(by);
  };

  const key = (name: string): string => {
    const at = canonicalize(name);
    if (own(at)) return at;
    const day = dateOf(at);
    if (day !== undefined) return day;
    return (free(at) && claimant(at)) || at;
  };

  /** The `canonicalize`d names the events gave the page at `key`, unordered. */
  const given = (key: string) => [...set.values(map.get(state.aliases, key) ?? set.empty())];

  const it: Resolver = {
    key,
    title: (name) => {
      const to = key(name);
      return to === canonicalize(name) ? name : titleOf(state, to);
    },
    aliasOf: (name) => {
      const at = canonicalize(name);
      const to = free(at) ? claimant(at) : undefined;
      return to === undefined ? undefined : titleOf(state, to);
    },
    aliases: (page) =>
      given(page).filter((alias) => alias !== page && key(alias) === page),
    names: (page) => [
      page,
      ...new Set(
        [...namesOf(page).map(canonicalize), ...given(page)].filter(
          (name) => name !== page && key(name) === page,
        ),
      ),
    ],
  };
  made.set(state, it);
  return it;
}
