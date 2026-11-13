/**
 * The block slice put together from its events (#238): the fold, the version
 * table, the undo table, and the prediction, which folds with them. Imports
 * every event module, and is imported by none of them.
 */
import { canonicalize } from "../titles/canonicalize.ts";
import * as forest from "../forest/forest.ts";
import type { Forest, Spot } from "../forest/forest.ts";
import * as map from "../immutable/immutable.ts";
import { each } from "../batch/batch.ts";
import type { EventOf } from "../event/over.ts";
import { BLOCK, blocksOn } from "./blocks.ts";
import type { Block, BlockState, Page } from "./blocks.ts";
import { BLOCK_CREATED } from "./created/created.ts";
import { BLOCK_EDITED } from "./edited/edited.ts";
import { BLOCK_DELETED } from "./deleted/deleted.ts";
import { BLOCK_INDENTED } from "./indented/indented.ts";
import { BLOCK_OUTDENTED } from "./outdented/outdented.ts";
import { BLOCK_MOVED } from "./moved/moved.ts";

/** Every block event. A new one is a module, and a line here. */
const EVENTS = [
  BLOCK_CREATED,
  BLOCK_EDITED,
  BLOCK_DELETED,
  BLOCK_INDENTED,
  BLOCK_OUTDENTED,
  BLOCK_MOVED,
] as const;

const BLOCKS = BLOCK.slice(EVENTS);

/** Every event this slice folds, and its payload: read off `EVENTS`, so it cannot drift. */
export type PageEvent = EventOf<(typeof EVENTS)[number]>;

/**
 * Event type → the payload `v` this build folds, which is also the `v` it
 * writes. The block half of `HANDLES`; the gate that reads it is `graphFold`.
 */
export const BLOCK_HANDLES = BLOCKS.handles;

/** How to undo each block event: the block part of `UNDO`. */
export const BLOCK_UNDO = BLOCKS.undo;

/**
 * Whether `event` is a block event this fold reads: one of its types, well
 * formed. A batch asks it of every event it holds before it folds any (#225).
 */
export const reads = BLOCKS.reads;

/**
 * The block fold: one event in, the state out. Hands back `state` itself for
 * any event that is not a well-formed block event. Whatever else `state`
 * holds is carried through as it is.
 */
export const reduce = BLOCKS.reduce;

/**
 * The page as it will stand once `events` are recorded: the renderer's unsent
 * writes, folded over the page main last sent. A guess, thrown away when each
 * write settles. Each event's `landed` keeps one the page already holds from
 * being drawn twice in the moment before it is dropped.
 *
 * Any other event is passed over, so a view can hand over every write it has
 * in flight, a property's among them, without sorting them first.
 */
export function predict(
  page: Page,
  events: readonly { type: string; payload: unknown }[],
): Page {
  if (events.length === 0) return page;
  let state = asState(page);
  for (const event of each(events)) {
    if (!BLOCKS.landed(state, event)) state = reduce(state, event);
  }
  return { ...page, blocks: blocksOn(state, page.title) };
}

/**
 * The one page, as the fold holds blocks. An id the page shows twice is
 * read once, where it first shows, as the fold would have written it.
 */
function asState(page: Page): BlockState {
  const key = canonicalize(page.title);
  let held: Forest = forest.empty();
  let texts = map.empty<string>();
  const plant = (blocks: readonly Block[], spot: (block: Block) => Spot) => {
    for (const block of blocks) {
      if (forest.has(held, block.id)) continue;
      held = forest.add(held, block.id, spot(block));
      texts = map.put(texts, block.id, block.text);
      plant(block.children, () => ({ under: block.id, at: "last" }));
    }
  };
  plant(page.blocks, () => ({ group: key, at: "last" }));
  return { forest: held, texts, titles: map.from([[key, page.title]]) };
}
