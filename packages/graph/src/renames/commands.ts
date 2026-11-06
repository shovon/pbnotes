/**
 * Writing a rename: the command that checks the page before it builds and
 * dispatches. The event is `events/pages/renamed/`.
 *
 * Refuses what the fold would skip, with a reason the window can show, so
 * nothing is written that folds to nothing, and writes nothing for a rename
 * to the spelling the page already has.
 */
import type { PagesEvent } from "../events/pages/slice.ts";
import { pageRenamed } from "../events/pages/renamed/renamed.ts";
import { resolver } from "../resolve/resolve.ts";
import { titleOf } from "../titles/titles.ts";
import { hasContent } from "../deletes/deletes.ts";
import { keyFor, outcome, redirect, namedBy } from "./renames.ts";
import type { Holds } from "./renames.ts";

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
