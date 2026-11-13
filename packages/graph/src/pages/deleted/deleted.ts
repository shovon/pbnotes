/**
 * `page.deleted`: the user was done with a page, and everything on it.
 * Everything about the event, from reading its payload to undoing it (#238).
 *
 * One event for the whole page, so a crash or a sync still arriving can never
 * leave it half deleted. It empties the page's blocks, properties, tags,
 * aliases and icon at its key, as the page stands at this point in fold
 * order: what is written after it in fold order is a later fact, and stands. `titles` is left
 * alone, so a page a link keeps alive still shows the spelling it had. Tags
 * other pages hold that point to it stay: they are on those pages, as links
 * to it are.
 */
import { canonicalize } from "../../titles/canonicalize.ts";
import { field, namespaced } from "../../event/event.ts";
import type { Named } from "../../event/event.ts";
import type { Written } from "../../event/over.ts";
import * as forest from "../../forest/forest.ts";
import * as map from "../../immutable/immutable.ts";
import * as set from "../../immutable/set.ts";
import { pageBlocks, stillGone } from "../../blocks/blocks.ts";
import { recreate } from "../../blocks/created/created.ts";
import { propertySet } from "../../properties/set/set.ts";
import { tagAdded } from "../../tags/added/added.ts";
import { aliasAdded } from "../../aliases/added/added.ts";
import { iconSet } from "../../icons/set/set.ts";
import { titleOf } from "../../titles/titles.ts";
import { DELETE } from "../delete.ts";
import type { PageDeleted } from "../delete.ts";

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : 1);

export const PAGE_DELETED = DELETE.define({
  type: namespaced("page.deleted"),
  v: 1,
  // A page has to be something once trimmed, as a property's does.
  parse: (payload): PageDeleted | undefined => {
    if (typeof payload !== "object" || payload === null) return undefined;
    const page = field(payload, "page");
    return typeof page === "string" && page.trim() !== "" ? { page } : undefined;
  },
  apply: (state, { page }) => {
    const key = canonicalize(page);
    let texts = state.texts;
    for (const gone of forest.inGroup(state.forest, key)) texts = map.remove(texts, gone);
    const blocks = forest.dropGroup(state.forest, key);
    const properties = map.remove(state.properties, key);
    const tags = map.remove(state.tags, key);
    const aliases = map.remove(state.aliases, key);
    const icons = map.remove(state.icons, key);
    const deletions = map.put(state.deletions, key, (map.get(state.deletions, key) ?? 0) + 1);
    return { ...state, forest: blocks, texts, properties, tags, aliases, icons, deletions };
  },
  undo: {
    // Every block back in place, then every property, tag and alias, each
    // kind by key so the log reads the same on every machine, and the icon,
    // each spelled as the graph before the delete had it.
    inverse: (state, { page }) => {
      const key = canonicalize(page);
      const title = titleOf(state, page);
      const blocks = pageBlocks(state, key);
      const icon = map.get(state.icons, key);
      return [
        ...blocks.flatMap((block, at) =>
          recreate(title, block, at === 0 ? { first: true } : { after: blocks[at - 1].id }),
        ),
        ...[...map.entries(map.get(state.properties, key) ?? map.empty<string>())].sort(byKey).map(([name, value]) =>
          propertySet(title, titleOf(state, name), value),
        ),
        ...[...set.values(map.get(state.tags, key) ?? set.empty())].sort().map((tag) => tagAdded(title, titleOf(state, tag))),
        ...[...set.values(map.get(state.aliases, key) ?? set.empty())].sort().map((alias) =>
          aliasAdded(title, titleOf(state, alias)),
        ),
        ...(icon === undefined ? [] : [iconSet(title, icon)]),
      ];
    },
    // A page that gained something since still takes its old content back
    // (#224): only what it held coming back from elsewhere stops it.
    touched: (state, { page }) => [stillGone(forest.inGroup(state.forest, canonicalize(page)))],
  },
});

/** The `page.deleted` event: `page` and everything on it are done with. */
export function pageDeleted(page: string): Written<Named<"page.deleted">, PageDeleted> {
  return PAGE_DELETED.build({ page });
}
