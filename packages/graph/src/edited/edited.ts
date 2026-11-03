/**
 * When each page was last changed: the latest `at` of any event that changed
 * what is on it. For display only. `at` is the writer's wall clock, which can
 * be wrong, and nothing is ordered by it.
 *
 * Kept as the latest seen, not the last folded, so the answer is the same
 * whatever order the events arrive in.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field } from "../events/events.ts";
import { find } from "../blocks/blocks.ts";
import type { BlockState } from "../blocks/blocks.ts";
import type { PropertyState } from "../properties/properties.ts";
import type { DeleteState } from "../deletes/deletes.ts";
import type { TagState } from "../tags/tags.ts";

/** Page key (`canonicalize`) → when it last changed, in ms since the epoch. */
export type EditedState = {
  readonly edited: Map<string, number>;
};

/** What a change is read off: the parts of the graph that hold what a user wrote. */
type Holds = BlockState & PropertyState & TagState & DeleteState & EditedState;

/** When an event was written, or undefined when it says nothing readable. */
function when(event: { at?: unknown }): number | undefined {
  if (typeof event.at !== "string") return undefined;
  const ms = Date.parse(event.at);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The page an event is about: the one its payload names, or for a block
 * event that names only a block, the page that block is on before or after.
 */
function pageOf(
  before: BlockState,
  after: BlockState,
  payload: unknown,
): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const page = field(payload, "page");
  if (typeof page === "string") return page;
  const id = field(payload, "id");
  if (typeof id !== "string") return undefined;
  return (find(before, id) ?? find(after, id))?.page;
}

/**
 * Records when `after` changed a page `before` held differently. `before` is
 * the graph ahead of the event and `after` the graph once the other slices
 * folded it. An event that changed no blocks, properties, tags or deletions (a
 * repeat, one aimed at a block that is not there, one this build skips) is
 * not an edit, and neither is one with no readable `at`: a prediction in the
 * renderer has none. Hands back `after` itself when nothing is recorded.
 */
export function reduce<S extends Holds>(
  before: S,
  after: S,
  event: { at?: unknown; payload: unknown },
): S {
  if (
    after.blocks === before.blocks &&
    after.properties === before.properties &&
    after.tags === before.tags &&
    after.deletions === before.deletions
  ) {
    return after;
  }
  const ms = when(event);
  const page = pageOf(before, after, event.payload);
  if (ms === undefined || page === undefined) return after;
  const key = canonicalize(page);
  const last = after.edited.get(key);
  if (last !== undefined && last >= ms) return after;
  return { ...after, edited: new Map(after.edited).set(key, ms) };
}

/** When `page` last changed, or undefined if nothing ever changed it. */
export function getEdited(state: EditedState, page: string): number | undefined {
  return state.edited.get(canonicalize(page));
}
