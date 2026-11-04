/**
 * `page.deleted`: the user was done with a page, and everything on it.
 * Everything about the event, from reading its payload to undoing it (#238).
 *
 * One event for the whole page, so a crash or a sync still arriving can never
 * leave it half deleted. It empties the page's blocks, properties, tags and
 * aliases at its key, as the page stands at this point in fold order: what is
 * written after it in fold order is a later fact, and stands. `titles` is left
 * alone, so a page a link keeps alive still shows the spelling it had. Tags
 * other pages hold that point to it stay: they are on those pages, as links
 * to it are.
 */
import { canonicalize } from "../../canonicalize/canonicalize.ts";
import { field, namespaced } from "../../events/events.ts";
import type { Named } from "../../events/events.ts";
import type { Written } from "../../over/over.ts";
import { ids, stillGone } from "../../blocks/blocks.ts";
import { recreate } from "../../blocks/created/created.ts";
import { propertySet } from "../../properties/set/set.ts";
import { tagAdded } from "../../tags/added/added.ts";
import { aliasAdded } from "../../aliases/added/added.ts";
import { titleOf } from "../../titles/titles.ts";
import { DELETE } from "../deletes.ts";
import type { PageDeleted } from "../deletes.ts";

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
    const blocks = new Map(state.blocks);
    blocks.delete(key);
    const properties = new Map(state.properties);
    properties.delete(key);
    const tags = new Map(state.tags);
    tags.delete(key);
    const aliases = new Map(state.aliases);
    aliases.delete(key);
    const deletions = new Map(state.deletions).set(key, (state.deletions.get(key) ?? 0) + 1);
    return { ...state, blocks, properties, tags, aliases, deletions };
  },
  undo: {
    // Every block back in place, then every property, tag and alias, each
    // spelled as the graph before the delete had it.
    inverse: (state, { page }) => {
      const key = canonicalize(page);
      const title = titleOf(state, page);
      const blocks = state.blocks.get(key) ?? [];
      return [
        ...blocks.flatMap((block, at) =>
          recreate(title, block, at === 0 ? { first: true } : { after: blocks[at - 1].id }),
        ),
        ...[...(state.properties.get(key) ?? [])].map(([name, value]) =>
          propertySet(title, titleOf(state, name), value),
        ),
        ...[...(state.tags.get(key) ?? [])].map((tag) => tagAdded(title, titleOf(state, tag))),
        ...[...(state.aliases.get(key) ?? [])].map((alias) =>
          aliasAdded(title, titleOf(state, alias)),
        ),
      ];
    },
    // A page that gained something since still takes its old content back
    // (#224): only what it held coming back from elsewhere stops it.
    touched: (state, { page }) => [stillGone(ids(state.blocks.get(canonicalize(page)) ?? []))],
  },
});

/** The `page.deleted` event: `page` and everything on it are done with. */
export function pageDeleted(page: string): Written<Named<"page.deleted">, PageDeleted> {
  return PAGE_DELETED.build({ page });
}
