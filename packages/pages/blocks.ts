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
 * `pages.ts` is what a caller points a log at. The split is the reason this
 * file is readable — and the reason it runs under plain `node --test` with
 * nothing around it.
 *
 * Both sides of the app fold with it, and so does anyone else reading a
 * folder. The app's main process folds the log, and its fold is the truth.
 * The renderer folds only the writes it has sent and not yet heard back
 * about, over what main last said, so that a key shows its result without
 * waiting for the disk — see `predict`. Two folds that have to agree are one
 * fold, or they drift: that is why this is a package and not a copy.
 */

import { canonicalize } from "./canonicalize.ts";
import { read } from "./reading.ts";
import type { Properties } from "./properties.ts";

export type Block = {
  id: string;
  text: string;
  /** Nested beneath this one, in the order they fold. Empty for a leaf. */
  children: Block[];
};

export type Page = {
  /**
   * What names the page: a local `YYYY-MM-DD` for a journal day, otherwise
   * the first spelling the fold saw for it. Case does not matter — `#Mira`
   * and `#mira` are one page, see `canonicalize` — but the log keeps each title as
   * it was typed, so the page shows a spelling someone actually wrote.
   */
  title: string;
  /** In the order they belong on the page, which is the order they fold. */
  blocks: Block[];
};

/**
 * Where a block sits: the array it is in, its index in that array, and the
 * block it hangs under. Undefined `parent` means the top level of the page.
 *
 * Exported because a caller needs the same walk the fold does — the app's
 * main to find the sibling an indent moves a block under, its renderer to
 * work out where a caret goes — and two copies of one tree walk that have to
 * agree drift.
 */
export function locate(
  blocks: Block[],
  id: string,
  parent?: Block,
): { siblings: Block[]; at: number; parent?: Block } | undefined {
  const at = blocks.findIndex((block) => block.id === id);
  if (at !== -1) return { siblings: blocks, at, parent };
  for (const block of blocks) {
    const hit = locate(block.children, id, block);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The deepest last descendant — the block that renders directly above
 * whatever comes after this one's subtree. Itself, for a leaf.
 */
export function lastLeaf(block: Block): Block {
  let last = block;
  while (last.children.length > 0) {
    last = last.children[last.children.length - 1];
  }
  return last;
}

/**
 * Every page, by `canonicalize`: a journal day or a page a link named.
 *
 * `titles` holds the first spelling the fold saw for each key, as the `page`
 * of a creation or a link in the text of a creation or an edit, and is never
 * overwritten: editing the link away later leaves it as it was. A page can
 * have a spelling and no blocks yet — a link names it before anyone writes on
 * it — so every key in `blocks` is in `titles` but not the other way round.
 *
 * `properties` sits beside the blocks, not inside them, so nothing that reads
 * blocks changes (`properties.ts`, #84). A property event spells its page in
 * `titles` too, so every key in `properties` is in `titles` as well.
 *
 * `Map` throughout, like `properties`: a title is whatever was typed, and as
 * a key of a plain object `toString` or `__proto__` is something every object
 * inherits. A fold that throws on an event the log keeps forever never opens
 * again (#62). A `Map` survives the structured clone to the renderer as well
 * as an object does (#146).
 */
export type Pages = {
  blocks: Map<string, Block[]>;
  titles: Map<string, string>;
  properties: Properties;
};

/** The blocks on a page, empty for one nothing has been written to. */
export function blocksOn(pages: Pages, title: string): Block[] {
  return pages.blocks.get(canonicalize(title)) ?? [];
}

/**
 * How a page is shown: the first spelling the fold saw for it, or `title`
 * itself for a page nothing has named yet.
 */
export function titleOf(pages: Pages, title: string): string {
  return pages.titles.get(canonicalize(title)) ?? title;
}

/**
 * `titles` with a spelling for each of `names` whose key has none yet, in
 * order, so the first of two spellings in one event is the one kept. The
 * same object back when every name already has one.
 *
 * Exported for the property fold, which spells a page the same way.
 */
export function spell(titles: Pages["titles"], names: string[]): Pages["titles"] {
  let next = titles;
  for (const name of names) {
    const key = canonicalize(name);
    if (next.has(key)) continue;
    // Copied once, on the first new name: what was handed in is a checkpoint.
    if (next === titles) next = new Map(titles);
    next.set(key, name);
  }
  return next;
}

/**
 * The pages a block's text links to. Nothing for text that is not a string:
 * a payload from a shared folder may be anything, and the parser would throw.
 */
function linksIn(text: unknown): string[] {
  return typeof text === "string" ? read(text).links : [];
}

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
 *
 * Named under the namespace, which is the only name an event has. The first
 * logs were written with bare names (`block.created`); those were rewritten
 * once (#39) and are not read (#40).
 */
export type PageEvent =
  | { type: Named<"block.created">; payload: BlockCreated }
  | { type: Named<"block.edited">; payload: BlockEdited }
  | { type: Named<"block.deleted">; payload: BlockDeleted }
  | { type: Named<"block.indented">; payload: BlockIndented }
  | { type: Named<"block.outdented">; payload: BlockOutdented };

/**
 * What every pbnotes event type starts with:
 * `github.com/shovon/pbnotes#block.created`. See #37.
 *
 * An identifier and not a link. Once a log holds it, it is on disk forever,
 * and it stays these bytes wherever the repository goes.
 *
 * Public contract, with `HANDLES`: programs other than the app read these
 * names. A name and a `v`, once written, never mean anything else — a new
 * meaning is a new `v` or a new name. See the README.
 *
 * ponytail: here because this is the only fold there is. A second feature's
 * fold takes this out to a package of its own.
 */
export const NAMESPACE = "github.com/shovon/pbnotes#";

/** An event type as it is written: under the namespace. */
type Named<T extends string> = `${typeof NAMESPACE}${T}`;

/**
 * Event type → the payload `v` this build folds, which is also the `v` it
 * writes. One number for both on purpose: a build that wrote a version its own
 * gate refuses would skip its own events.
 *
 * Keyed on `PageEvent['type']`, so the table cannot drift from the schema — a
 * new event type without a version here, or a version here for an event type
 * that does not exist, stops the build.
 *
 * The block events' half of `HANDLES` in `pages.ts`, which is the table the
 * gate reads. The gate itself is `pagesFold` there. Its job is the case a
 * single-writer log could never produce: a newer build on another machine
 * writing something this one does not understand. Those events are skipped.
 */
export const BLOCK_HANDLES: Record<PageEvent["type"], number> = {
  [`${NAMESPACE}block.created`]: 1,
  // 2 since the page came off the payload. Nothing needed an upcast in this
  // direction — the field is simply unread — but an older build handed one of
  // these would look up `state[undefined]`, miss, and drop the user's text
  // without a word. At `v: 2` its own gate refuses the event and says so.
  [`${NAMESPACE}block.edited`]: 2,
  [`${NAMESPACE}block.deleted`]: 2,
  [`${NAMESPACE}block.indented`]: 2,
  [`${NAMESPACE}block.outdented`]: 2,
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

/** Where a block sits, and which page it sits on, by the title it shows. */
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
  for (const [key, blocks] of pages.blocks) {
    const where = locate(blocks, id);
    if (where) return { page: pages.titles.get(key) ?? key, blocks, ...where };
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
  return blocks
    ? { ...state, blocks: new Map(state.blocks).set(canonicalize(found.page), blocks) }
    : state;
}

/**
 * The default branch of the fold. `event` is `never` to the compiler, so
 * adding a type to `PageEvent` without a case for it stops the build here —
 * which matters because the alternative is a page that silently folds without
 * part of itself, the exact silence this log is built against.
 *
 * At run time it is reachable and ordinary: an event type some other build
 * wrote, already refused by the gate in `pagesFold`. The view is left as it
 * was either way.
 */
function foreign(_event: never, state: Pages): Pages {
  return state;
}

/** A `PageEvent` with the namespace off its type, which is what `reduce` switches on. */
type Bare<E> = E extends {
  type: `${typeof NAMESPACE}${infer T}`;
  payload: infer P;
}
  ? { type: T; payload: P }
  : never;

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
export function reduce(
  state: Pages,
  event: { type: string; payload: unknown },
): Pages {
  // Ours are under the namespace and nothing else is: a bare `block.created`
  // is not this event (#40), and the gate in `pagesFold` refuses one too.
  if (!event.type.startsWith(NAMESPACE)) return state;
  // The one cast in the fold: "if this is one of ours, this is its shape."
  // `foreign` below is where that turns out not to be true.
  const it = {
    ...event,
    type: event.type.slice(NAMESPACE.length),
  } as unknown as Bare<PageEvent>;

  switch (it.type) {
    case "block.created": {
      const { id, text, after } = it.payload;
      // A string for whatever was there: a missing page used to file under
      // `"undefined"` as a key, and `canonicalize` would throw on it.
      const page = String(it.payload.page);
      const blocks = blocksOn(state, page);
      const block: Block = { id, text, children: [] };
      // `addBlock` refuses an `after` the page does not have, so missing it
      // here means a log written by something else. Append rather than drop: a
      // block in the wrong place can be moved, one the fold discarded is gone.
      const next = (after && beside(blocks, after, block)) || [
        ...blocks,
        block,
      ];
      return {
        ...state,
        blocks: new Map(state.blocks).set(canonicalize(page), next),
        // The page before its links: it is where the user was writing.
        titles: spell(state.titles, [page, ...linksIn(text)]),
      };
    }

    case "block.edited": {
      const { id, text } = it.payload;
      const next = onBlock(state, id, ({ blocks }) => retext(blocks, id, text));
      // An edit to a block the ledger lacks names nothing either.
      if (next === state) return state;
      return { ...next, titles: spell(next.titles, linksIn(text)) };
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
        // Under itself or its own subtree: the detach would take `parent`
        // with it, and both would leave the page. Two machines each indenting
        // one block under the other before they sync is how this gets
        // written (#62).
        if (parent === id || locate(moving.children, parent)) return undefined;
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
}

/**
 * What indenting a block is, on the page as it stands: filed under the
 * sibling above it. Undefined for a block that is first among its siblings —
 * there is nothing above it to move under — or one the page does not have.
 *
 * Here, and not in the store, because whoever predicts a move has to resolve
 * it exactly as whoever records it does.
 */
export function indented(
  blocks: Block[],
  id: string,
): BlockIndented | undefined {
  const found = locate(blocks, id);
  return found && found.at > 0
    ? { id, parent: found.siblings[found.at - 1].id }
    : undefined;
}

/**
 * What outdenting a block is: directly beneath the block it hangs under.
 * Undefined at the top level, where there is nothing to come out of.
 */
export function outdented(
  blocks: Block[],
  id: string,
): BlockOutdented | undefined {
  const parent = locate(blocks, id)?.parent;
  return parent ? { id, after: parent.id } : undefined;
}

/**
 * Whether the page already shows what `event` did. Asked only of the events
 * that are not safe to fold twice: a creation would put a second block on the
 * page, and an outdent would take the siblings now below the block as its
 * children all over again.
 */
function landed(state: Pages, event: PageEvent): boolean {
  if (event.type === `${NAMESPACE}block.created`) return !!find(state, event.payload.id);
  const found = find(state, event.payload.id);
  if (event.type === `${NAMESPACE}block.indented`) {
    return found?.parent?.id === event.payload.parent;
  }
  if (event.type === `${NAMESPACE}block.outdented`) {
    return found?.siblings[found.at - 1]?.id === event.payload.after;
  }
  return false;
}

/**
 * The page as it will stand once `events` have been recorded: writes the
 * renderer has sent and not yet heard back about, folded over the page main
 * last sent.
 *
 * A guess, and thrown away on purpose. The renderer drops an event when its
 * write settles, and a write settles only once the state it led to is in —
 * so there is a moment when the page already holds an event that is still in
 * `events`. `landed` is what makes that moment draw the same page rather
 * than the event twice. A write main refuses is dropped the same way, and the
 * page goes back to what main has.
 */
export function predict(page: Page, events: PageEvent[]): Page {
  if (events.length === 0) return page;
  const key = canonicalize(page.title);
  let state: Pages = {
    blocks: new Map([[key, page.blocks]]),
    titles: new Map([[key, page.title]]),
    properties: new Map(),
  };
  for (const event of events) {
    if (!landed(state, event)) state = reduce(state, event);
  }
  return { ...page, blocks: blocksOn(state, page.title) };
}
