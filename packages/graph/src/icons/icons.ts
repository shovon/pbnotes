/**
 * Page icons: one string per page, shown beside its title (#322). The graph
 * never reads it: an emoji, an `image:<hash>`, or anything a later build
 * draws is the same opaque string here, and what it means is up to whoever
 * draws it. A reader that cannot draw a value treats it as no icon.
 *
 * An icon is not a property: a property key is a page (#174), so an `icon`
 * key would name an "icon" page and show in every properties table.
 *
 * This file holds what both icon events share: the state, the payloads, and
 * how a page's icon is read and written. The events themselves are the
 * folders beside this file, one module each, and `slice.ts` is the list that
 * puts them together.
 *
 * Nothing here reads blocks, properties, tags or aliases, and nothing in
 * those folds reads this.
 */

import * as map from "../immutable/immutable.ts";
import type { ImmutableMap } from "../immutable/immutable.ts";
import { canonicalize } from "../titles/canonicalize.ts";
import { field } from "../event/event.ts";
import { over } from "../event/over.ts";
import { spell } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";

/**
 * What the icon fold reads and writes: `canonicalize(page)` → its icon. A
 * page with no icon has no entry. The spelling of every page is in `titles`.
 *
 * A `Map`, so `__proto__` is an ordinary page (#62), and the state survives
 * the structured clone to the renderer (#146).
 */
export type IconState = {
  readonly icons: ImmutableMap<string>;
  readonly titles: Titles;
};

/** `define` and `slice` for the icon events. */
export const ICON = over<IconState>();

// ── The payloads ────────────────────────────────────────────────────────────

/** `page`'s icon is now `icon`. `""` is an icon, not an absence. */
export type IconSet = { page: string; icon: string };

/** `page` has no icon. */
export type IconRemoved = { page: string };

/**
 * The page both icon events carry, or undefined when the payload is
 * malformed: not an object, or a `page` that is not a string or is blank once
 * trimmed. Malformed is skipped whole. Any field beyond what an event reads
 * is ignored.
 */
export function readPage(payload: unknown): IconRemoved | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = field(payload, "page");
  return typeof page === "string" && page.trim() !== "" ? { page } : undefined;
}

// ── A page's icon ───────────────────────────────────────────────────────────

/** `page`'s icon as written, or undefined for none. No resolving. */
export function iconOf(state: IconState, page: string): string | undefined {
  return map.get(state.icons, canonicalize(page));
}

/**
 * `state` with `page`'s icon set to `icon`, or removed when `icon` is
 * undefined. The page is spelled either way. Pure, and never changes what it
 * is handed: removing an icon the page lacks hands back `state` itself
 * unless the spelling is new.
 */
export function withIcon<S extends IconState>(state: S, page: string, icon: string | undefined): S {
  const titles = spell(state.titles, [page]);
  const at = canonicalize(page);
  if (icon !== undefined) return { ...state, titles, icons: map.put(state.icons, at, icon) };
  if (map.get(state.icons, at) === undefined) {
    return titles === state.titles ? state : { ...state, titles };
  }
  return { ...state, titles, icons: map.remove(state.icons, at) };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Every page that has an icon: an icon names its page, as a tag does. */
export function* named(state: IconState): Generator<string> {
  yield* map.keys(state.icons);
}
