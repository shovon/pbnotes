/**
 * Writing to a page as a whole: the commands that check the page before they
 * build and dispatch. The events are `deleted/` and `renamed/`.
 *
 * A rename refuses what the fold would skip, with a reason the window can
 * show, so nothing is written that folds to nothing, and writes nothing for a
 * rename to the spelling the page already has.
 */
import type { BlockState } from "../blocks/blocks.ts";
import type { PropertyState } from "../properties/properties.ts";
import type { TagState } from "../tags/tags.ts";
import type { AliasState } from "../aliases/aliases.ts";
import type { IconState } from "../icons/icons.ts";
import type { PagesEvent } from "./slice.ts";
import { pageDeleted } from "./deleted/deleted.ts";
import { pageRenamed } from "./renamed/renamed.ts";
import { resolver } from "../resolve/resolve.ts";
import { titleOf } from "../titles/titles.ts";
import { hasContent } from "./delete.ts";
import { keyFor, outcome, redirect, namedBy } from "./rename.ts";
import type { Holds } from "./rename.ts";

// ── Deleting ────────────────────────────────────────────────────────────────

/**
 * What `deletePage` needs: the state as it stands, and a way to append the
 * event. `GraphView` is one.
 */
export type DeletesView = {
  readonly state: BlockState & PropertyState & TagState & AliasState & IconState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: PagesEvent["type"], payload: unknown): Promise<unknown>;
};

/**
 * Deletes `page`'s blocks, properties, tags and aliases, as one event. A page with nothing
 * on it writes nothing: the delete would change nothing, and the log does not
 * collect events that mean nothing.
 */
export async function deletePage(view: DeletesView, page: string): Promise<void> {
  if (!hasContent(view.state, page)) return;
  const event = pageDeleted(page);
  await view.dispatch(event.v, event.type, event.payload);
}

// ── Renaming ────────────────────────────────────────────────────────────────

/**
 * What `renamePage` needs: the state as it stands, and a way to append the
 * event. `GraphView` is one.
 */
export type RenamesView = {
  readonly state: Holds;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: PagesEvent["type"], payload: unknown): Promise<unknown>;
};

/**
 * A title a link can name: something once trimmed, and nothing that would
 * end the link it is written into.
 */
function requireTitle(to: string): void {
  if (to.trim() === "") throw new Error("A page needs a title");
  if (/\[\[|\]\]|[\r\n]/.test(to)) throw new Error("A page title can't hold [[, ]] or a line break");
}

/**
 * The page `from` opens is now called `to`, as one `page.renamed`. Hands back
 * the page's title as it then shows.
 *
 * A page with nothing on it is renamed like any other: the links to it
 * follow. One nothing names either writes nothing, and hands back `to`. Refuses a `to` that has content of its own
 * (that would be a merge, #110), and a `to` that opens another page, through
 * an alias or a rename. A `to` only links name has no content, and a rename
 * onto it goes through. A rename to the spelling the page has writes nothing.
 */
export async function renamePage(view: RenamesView, from: string, to: string): Promise<string> {
  requireTitle(to);
  const names = resolver(view.state);
  const page = names.title(from);
  const it = { from: page, to };
  const was = keyFor(page);
  const now = keyFor(to);
  const does = outcome(view.state, it);
  if (does === "nothing" && was === now) return titleOf(view.state, now);
  if (hasContent(view.state, now)) throw new Error(`“${titleOf(view.state, now)}” already has content`);
  const opens = names.key(to);
  if (opens !== now && opens !== was && redirect(view.state, to) === undefined) {
    throw new Error(`“${to}” already opens another page`);
  }
  if (does === "nothing") {
    // A page nothing is on and nothing names has nothing to rename: the
    // window goes to `to`, which is as empty, and the log keeps no event.
    if (!hasContent(view.state, was) && !namedBy(view.state, was)) return to;
    throw new Error(`“${to}” already opens another page`);
  }
  const event = pageRenamed(page, to);
  await view.dispatch(event.v, event.type, event.payload);
  return titleOf(view.state, keyFor(to));
}
