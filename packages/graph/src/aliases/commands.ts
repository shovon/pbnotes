/**
 * Writing aliases (#383): a command per change, each checking the page's
 * aliases before it builds and dispatches. The events are the builders beside
 * this file; this is what decides whether to write one.
 *
 * Every command refuses what the fold would skip, and what no alias can do
 * (the page's own title, and a `YYYY-MM-DD`, which no alias ever takes), so
 * nothing is written that does nothing; and writes nothing for a change that
 * changes nothing. An alias another rule keeps from opening the page is
 * written all the same: a sync can change that later.
 */
import { DATE_PATTERN } from "../journal/journal.ts";
import { canonicalize } from "../titles/canonicalize.ts";
import { answersTo } from "./aliases.ts";
import type { AliasState } from "./aliases.ts";
import type { AliasEvent } from "./slice.ts";
import { aliasAdded } from "./added/added.ts";
import { aliasRemoved } from "./removed/removed.ts";

/**
 * What the commands need: the state as it stands, and a way to append one of
 * this fold's events. `GraphView` is one.
 */
export type AliasesView = {
  readonly state: AliasState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: AliasEvent["type"], payload: unknown): Promise<unknown>;
};

/** The fold's rule for a page or an alias: something, once trimmed. */
function requireName(name: string, what: string): void {
  if (name.trim() === "") throw new Error(`An alias needs a ${what}`);
}

/**
 * `page` now answers to `alias`. An alias the page already has writes
 * nothing; the page's own title and a `YYYY-MM-DD` are refused.
 */
export async function addAlias(view: AliasesView, page: string, alias: string): Promise<void> {
  requireName(page, "page");
  requireName(alias, "name");
  if (canonicalize(alias) === canonicalize(page)) throw new Error("A page's own title is not an alias");
  if (DATE_PATTERN.test(canonicalize(alias))) throw new Error("A date always opens its day");
  if (answersTo(view.state, page, alias)) return;
  const event = aliasAdded(page, alias);
  await view.dispatch(event.v, event.type, event.payload);
}

/** `page` no longer answers to `alias`. An alias the page does not have writes nothing. */
export async function removeAlias(view: AliasesView, page: string, alias: string): Promise<void> {
  requireName(page, "page");
  requireName(alias, "name");
  if (!answersTo(view.state, page, alias)) return;
  const event = aliasRemoved(page, alias);
  await view.dispatch(event.v, event.type, event.payload);
}
