/**
 * Writing icons: a command per change, each checking the page's icon before
 * it builds and dispatches (#322).
 *
 * Every command refuses what the fold would skip (a blank page), and writes
 * nothing for a change that changes nothing, so the log does not collect
 * events that mean nothing. What an icon is, the commands don't check: that
 * is the reader's, as it is the fold's.
 */
import { iconOf } from "./icons.ts";
import type { IconState } from "./icons.ts";
import type { IconEvent } from "../events/icons/slice.ts";
import { iconSet } from "../events/icons/set/set.ts";
import { iconRemoved } from "../events/icons/removed/removed.ts";

/**
 * What the commands need: the state as it stands, and a way to append one of
 * this fold's events. `GraphView` is one.
 */
export type IconsView = {
  readonly state: IconState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: IconEvent["type"], payload: unknown): Promise<unknown>;
};

/** The fold's rule for a page: something, once trimmed. */
function requirePage(page: string): void {
  if (page.trim() === "") throw new Error("An icon needs a page");
}

/**
 * `page`'s icon is now `icon`. Setting the icon it already has writes
 * nothing. Hands back the page's icon as it then stands.
 */
export async function setIcon(view: IconsView, page: string, icon: string): Promise<string | undefined> {
  requirePage(page);
  if (iconOf(view.state, page) !== icon) {
    const event = iconSet(page, icon);
    await view.dispatch(event.v, event.type, event.payload);
  }
  return iconOf(view.state, page);
}

/** `page` has no icon. Removing an icon it does not have writes nothing. */
export async function removeIcon(view: IconsView, page: string): Promise<undefined> {
  requirePage(page);
  if (iconOf(view.state, page) !== undefined) {
    const event = iconRemoved(page);
    await view.dispatch(event.v, event.type, event.payload);
  }
  return undefined;
}
