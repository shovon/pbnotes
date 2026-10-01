/**
 * The block is the primitive, and this is everything that knows what one is.
 *
 * A page is not a record anywhere: it is a title that blocks carry, so pages
 * come into being by being named and go away by having nothing left on them.
 * That is why only a creation says anything about a page — it is where the
 * user wrote the block — and why every event after it names the block alone.
 *
 * Nothing here touches a log, a file, a device or a window. It is the domain:
 * an event schema, the tree operations a fold is made of, and the fold itself.
 * `pages-store.ts` is the wiring that points a log at it. The split is the
 * reason this file is readable — and the reason it runs under plain
 * `node --test` with nothing around it.
 */
import { locate } from "../../../../../shared/pages.ts";
import type { Block } from "../../../../../shared/pages.ts";
import type { Reducer } from "../../../../ledger/projection/projection.ts";

/** Title → the blocks on it: a journal day or a page a link named. */
export type Pages = Record<string, Block[]>;

/**
 * Where the user wrote a block. The only event that carries a page, because
 * it is the only one that says anything about one: a block's page is settled
 * when it is created and no event moves it to another.
 */
export type BlockCreated = {
  page: string;
  id: string;
  text: string;
  /**
   * The sibling it was written directly beneath, at whatever depth that
   * sibling sits. Absent means the end of the page.
   *
   * A position, never an index: an index stored on a record has to be
   * rewritten on every neighbour the moment anything lands between them,
   * whereas which block the user wrote beneath is a fact that stays true
   * forever. The array is derived from it, the same way on replay as it was
   * live.
   */
  after?: string;
};

/** The later of two facts about one block's text. The earlier one stays. */
export type BlockEdited = { id: string; text: string };

/** That the user was done with it. Nothing leaves the disk. */
export type BlockDeleted = { id: string };

/** The block it became the last child of, resolved when the user indented. */
export type BlockIndented = { id: string; parent: string };

/** The block it used to hang under, and now sits directly beneath. */
export type BlockOutdented = { id: string; after: string };

/**
 * Every event this fold understands, and the shape each one's payload has.
 *
 * The four that follow a creation were once written with a `page` too. It is
 * not declared here because it is not read: an extra field on disk is
 * invisible to a fold that never asks for it, which is what made dropping it
 * an upcast-free change in this direction. `blocks.test.ts` pins that a `v1`
 * payload still folds, including one whose page is outright wrong.
 */
export type PageEvent =
  | { type: "block.created"; payload: BlockCreated }
  | { type: "block.edited"; payload: BlockEdited }
  | { type: "block.deleted"; payload: BlockDeleted }
  | { type: "block.indented"; payload: BlockIndented }
  | { type: "block.outdented"; payload: BlockOutdented };

/**
 * Event type → the payload `v` this build folds, which is also the `v` it
 * writes. One number for both on purpose: a build that wrote a version its own
 * gate refuses would skip its own events.
 *
 * Keyed on `PageEvent['type']`, so the table cannot drift from the schema — a
 * new event type without a version here, or a version here for an event type
 * that does not exist, stops the build.
 *
 * The gate itself is `Projection`'s. Its job is the case a single-writer log
 * could never produce: a newer build on another machine writing something this
 * one does not understand. Those events are skipped, as they always were, but
 * counted and reported rather than silently leaving holes in the page.
 */
export const HANDLES: Record<PageEvent["type"], number> = {
  "block.created": 1,
  // 2 since the page came off the payload. Nothing needed an upcast in this
  // direction — the field is simply unread — but an older build handed one of
  // these would look up `state[undefined]`, miss, and drop the user's text
  // without a word. At `v: 2` its own gate refuses the event and says so.
  "block.edited": 2,
  "block.deleted": 2,
  "block.indented": 2,
  "block.outdented": 2,
};

/**
 * `block` spliced in directly after `after`, wherever in the tree that is.
 * Undefined when `after` is not in this subtree, so the caller can tell
 * "not here, keep looking" from "here, and this is the result".
 *
 * A sibling of `after`, which is what makes `after` alone enough to place a
 * block at any depth: Enter inside a nested block writes the next one beside
 * it, not back at the top level.
 */
export function beside(
  blocks: Block[],
  after: string,
  block: Block,
): Block[] | undefined {
  const at = blocks.findIndex((it) => it.id === after);
  if (at !== -1) {
    const next = [...blocks];
    next.splice(at + 1, 0, block);
    return next;
  }
  for (let i = 0; i < blocks.length; i++) {
    const children = beside(blocks[i].children, after, block);
    if (!children) continue;
    const next = [...blocks];
    next[i] = { ...blocks[i], children };
    return next;
  }
  return undefined;
}

/** The block and everything under it, gone from wherever it sat. */
export function without(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) => ({ ...block, children: without(block.children, id) }));
}

/** One block's text replaced, wherever in the tree it is. */
function retext(blocks: Block[], id: string, text: string): Block[] {
  return blocks.map((block) =>
    block.id === id
      ? { ...block, text }
      : { ...block, children: retext(block.children, id, text) },
  );
}

/** `parent`'s children put through `next`, wherever `parent` is. */
function mapChildren(
  blocks: Block[],
  parent: string,
  next: (children: Block[]) => Block[],
): Block[] {
  return blocks.map((it) =>
    it.id === parent
      ? { ...it, children: next(it.children) }
      : { ...it, children: mapChildren(it.children, parent, next) },
  );
}

/** Where a block sits, and which page it sits on. */
export type Found = NonNullable<ReturnType<typeof locate>> & {
  page: string;
  blocks: Block[];
};

/**
 * The block, wherever in the project it is. A block id is unique across every
 * page, so it is enough on its own — which is why nothing after
 * `block.created` carries a page.
 *
 * ponytail: scans every page per event, so a replay is O(blocks × events).
 * Keep a block id → page index in the fold state if a long log ever shows up
 * as a slow launch; a delete would have to drop that block's whole subtree
 * from it, the way `without` does.
 */
export function find(pages: Pages, id: string): Found | undefined {
  for (const [page, blocks] of Object.entries(pages)) {
    const where = locate(blocks, id);
    if (where) return { page, blocks, ...where };
  }
  return undefined;
}

/**
 * Applies `change` to the page the block turned out to be on. A block that is
 * not in the project, or an `undefined` from `change`, leaves the view exactly
 * as it was.
 *
 * The page comes from `find` and never from a payload. A page on an edit would
 * be a copy of where the block sat when the edit was typed — true on the
 * machine that wrote it, and a miss that drops the user's text the moment
 * anything else is true. This is the one place that could reintroduce that, so
 * it is the only place allowed to choose which page a fold writes to.
 */
function onBlock(
  state: Pages,
  id: string,
  change: (found: Found) => Block[] | undefined,
): Pages {
  const found = find(state, id);
  if (!found) return state;
  const blocks = change(found);
  return blocks ? { ...state, [found.page]: blocks } : state;
}

/**
 * The default branch of the fold. `event` is `never` to the compiler, so
 * adding a type to `PageEvent` without a case for it stops the build here —
 * which matters because the alternative is a page that silently folds without
 * part of itself, the exact silence this log is built against.
 *
 * At run time it is reachable and ordinary: an event type some other build
 * wrote, already counted into `ViewStatus` by the gate. The view is left as it
 * was either way.
 */
function foreign(_event: never, state: Pages): Pages {
  return state;
}

/**
 * Pure, and over state that survives a structured clone: the view crosses to
 * the renderer as data and the fold may one day run off-thread.
 *
 * Each branch pulls in the fields its own event has and no others. A payload
 * shape that changes gets a new `v` and a branch of its own here; the file on
 * disk is never rewritten, because an edit is a second fact appended after the
 * first rather than a correction of it.
 *
 * Guards stay on fields the schema calls required. The types describe what
 * *this build writes*; what arrives in a shared folder was written by
 * something else, and may be anything.
 */
export const reduce: Reducer<Pages> = (state, event) => {
  // The one cast in the fold: "if this is one of ours, this is its shape."
  // `foreign` below is where that turns out not to be true.
  const it = event as unknown as PageEvent;

  switch (it.type) {
    case "block.created": {
      const { page, id, text, after } = it.payload;
      const blocks = state[page] ?? [];
      const block: Block = { id, text, children: [] };
      // `addBlock` refuses an `after` the page does not have, so missing it
      // here means a log written by something else. Append rather than drop: a
      // block in the wrong place can be moved, one the fold discarded is gone.
      const next = (after && beside(blocks, after, block)) || [
        ...blocks,
        block,
      ];
      return { ...state, [page]: next };
    }

    case "block.edited": {
      const { id, text } = it.payload;
      return onBlock(state, id, ({ blocks }) => retext(blocks, id, text));
    }

    case "block.deleted": {
      const { id } = it.payload;
      // A plain filter, no tombstone. Nothing later in the log needs to know
      // this block was here: `after` only ever names a block that was present
      // when it was written, and a stray edit arriving afterwards already
      // folds to nothing through `onBlock`.
      //
      // The subtree goes with it. The events that built those children are all
      // still on disk — what the fold stops showing is a block the user said
      // they were done with, and everything they had filed underneath it.
      return onBlock(state, id, ({ blocks }) => without(blocks, id));
    }

    case "block.indented": {
      const { id, parent } = it.payload;
      return onBlock(state, id, (found) => {
        // A parent on another page is not a move across pages; there is no
        // such event yet, so it folds to nothing.
        if (!parent || !locate(found.blocks, parent)) return undefined;
        // Read before the detach: the block carries its own children across,
        // so what lands under `parent` is the whole subtree, not a stripped
        // root.
        const moving = found.siblings[found.at];
        return mapChildren(without(found.blocks, id), parent, (children) => [
          ...children,
          moving,
        ]);
      });
    }

    case "block.outdented": {
      const { id, after } = it.payload;
      return onBlock(state, id, (found) => {
        if (!after || !found.parent) return undefined;

        // The siblings below it come along as its own children. Leaving them
        // behind would strand them inside the old parent, which renders
        // *above* where this block is going — so the page would come back
        // reading in a different order than the user left it, off one
        // keystroke that only asked about depth.
        const moving = found.siblings[found.at];
        const trailing = found.siblings.slice(found.at + 1);
        const outdented = {
          ...moving,
          children: [...moving.children, ...trailing],
        };
        const trimmed = mapChildren(found.blocks, found.parent.id, (children) =>
          children.slice(0, found.at),
        );
        // `after` is the block it used to hang under, so this lands it
        // directly beneath, at that block's own level.
        return beside(trimmed, after, outdented) ?? [...trimmed, outdented];
      });
    }

    default:
      return foreign(it, state);
  }
};
