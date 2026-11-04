/**
 * Undoing a page delete (#233): the page's blocks, properties, tags and
 * aliases written back, each spelled as the graph before the delete had it.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { NAMESPACE, stringOf } from "../events/events.ts";
import type { Batched } from "../batch/batch.ts";
import type { Undo } from "../undo/undo.ts";
import type { BlockState } from "../blocks/blocks.ts";
import { ids, recreate, stillGone } from "../blocks/undo.ts";
import { propertySet } from "../properties/properties.ts";
import type { PropertyState } from "../properties/properties.ts";
import { tagAdded } from "../tags/tags.ts";
import type { TagState } from "../tags/tags.ts";
import { aliasAdded } from "../aliases/aliases.ts";
import type { AliasState } from "../aliases/aliases.ts";
import { titleOf } from "../titles/titles.ts";
import type { DeleteEvent } from "./deletes.ts";

/** What a page delete takes, and so what undoing one puts back. */
type Held = BlockState & PropertyState & TagState & AliasState;

/** Every block back in place, then every property, tag and alias. */
function inverse(state: Held, { payload }: Batched): Batched[] {
  const page = stringOf(payload, "page");
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
    ...[...(state.aliases.get(key) ?? [])].map((alias) => aliasAdded(title, titleOf(state, alias))),
  ];
}

/** How to undo a page delete. Keyed on `DeleteEvent['type']`, so it is not missed. */
export const DELETE_UNDO: Record<DeleteEvent["type"], Undo<Held>> = {
  [`${NAMESPACE}page.deleted`]: {
    inverse,
    // A page that gained something since still takes its old content back
    // (#224): only what it held coming back from elsewhere stops it.
    touched: (state, { payload }) => [
      stillGone(ids(state.blocks.get(canonicalize(stringOf(payload, "page"))) ?? [])),
    ],
  },
};
