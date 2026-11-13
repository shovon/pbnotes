/**
 * `page.renamed`: the page `from` is now called `to`. Everything about the
 * event, from reading its payload to undoing it (#108). What a rename does
 * is `renames/renames.ts`.
 *
 * Undone by renaming back, and taking off the alias that leaves on the old
 * page, so the new name is free again. It stops, as every undo does, once
 * anything it moved has changed since. Renaming back is not exact for the
 * links it rewrote: each comes back naming the page as it is spelled, so
 * `[[bridal falls]]` comes back as `[[Bridal Falls]]`, and a bare tag that
 * took brackets keeps them (`#A` renamed to `A B` reads `#[[A B]]`, and back,
 * `#[[A]]`). Each opens the same page.
 */
import { namespaced } from "../../events.ts";
import type { Named } from "../../events.ts";
import type { Written } from "../../../over/over.ts";
import { same } from "../../../undo/undo.ts";
import * as forest from "../../../forest/forest.ts";
import * as map from "../../../immutable/immutable.ts";
import * as set from "../../../immutable/set.ts";
import { titleOf } from "../../../titles/titles.ts";
import { aliasRemoved } from "../../aliases/removed/removed.ts";
import { hasContent } from "../../../deletes/deletes.ts";
import { keyFor, outcome, readRenamed, rename } from "../../../renames/renames.ts";
import type { Holds, PageRenamed } from "../../../renames/renames.ts";
import { over } from "../../../over/over.ts";

/**
 * A reading of the page at `key` as a rename left it: its blocks in order
 * with their text, its properties, tags, aliases and icon. Ids and names only.
 */
function page(key: string): (now: Holds) => string {
  return (now) =>
    JSON.stringify([
      forest.inGroup(now.forest, key).map((id) => [id, forest.node(now.forest, id)?.parent, map.get(now.texts, id)]),
      [...map.entries(map.get(now.properties, key) ?? map.empty<string>())].sort(),
      [...set.values(map.get(now.tags, key) ?? set.empty())].sort(),
      [...set.values(map.get(now.aliases, key) ?? set.empty())].sort(),
      map.get(now.icons, key) ?? null,
    ]);
}

export const PAGE_RENAMED = over<Holds>().define({
  type: namespaced("page.renamed"),
  v: 1,
  parse: readRenamed,
  apply: (state, it) => rename(state, it),
  undo: {
    inverse: (state, it) => {
      const does = outcome(state, it);
      if (does === "nothing") return [];
      const was = keyFor(it.from);
      const back = titleOf(state, was);
      if (does === "spell") return [pageRenamed(it.to, back)];
      return [pageRenamed(it.to, back), aliasRemoved(back, it.to)];
    },
    touched: (state, it) => {
      const was = keyFor(it.from);
      const now = keyFor(it.to);
      if (was === now) return [same((after: Holds) => titleOf(after, now))];
      return [same(page(now)), same((after: Holds) => hasContent(after, was))];
    },
  },
});

/** The `page.renamed` event: the page `from` is now called `to`. */
export function pageRenamed(from: string, to: string): Written<Named<"page.renamed">, PageRenamed> {
  return PAGE_RENAMED.build({ from, to });
}

