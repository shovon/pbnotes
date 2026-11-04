/**
 * Writing a page delete: the command that checks the page before it builds
 * and dispatches. The event is `deleted/`.
 */
import type { BlockState } from "../blocks/blocks.ts";
import type { PropertyState } from "../properties/properties.ts";
import type { TagState } from "../tags/tags.ts";
import type { AliasState } from "../aliases/aliases.ts";
import { hasContent } from "./deletes.ts";
import type { DeleteEvent } from "./slice.ts";
import { pageDeleted } from "./deleted/deleted.ts";

// ── The command ─────────────────────────────────────────────────────────────

/**
 * What `deletePage` needs: the state as it stands, and a way to append the
 * event. `GraphView` is one.
 */
export type DeletesView = {
  readonly state: BlockState & PropertyState & TagState & AliasState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: DeleteEvent["type"], payload: unknown): Promise<unknown>;
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
