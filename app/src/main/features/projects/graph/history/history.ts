/**
 * Undo's history (#234): the steps this session wrote, and the undos it can
 * redo, for each project's graph it wrote to. In memory only, and nothing
 * here writes: the session writes what this says to, and tells it after.
 *
 * A step is remembered once, when it is written (#242): the events that undo
 * it and the readings of what it touched, never a graph. So a step costs a
 * few events and values however large the project, and the history can hold
 * `LIMIT` of them.
 *
 * Kept per graph, by the view's object, which is one per open project's
 * ledger. A write still queued for the project that was open before a switch
 * records its step under that project's graph, never under the new one's,
 * so an undo never writes one project's inverse into another.
 */
import { each, find, holds, remember, titleOf } from "@pbnotes/graph";
import type { Batched, Graph, Remembered } from "@pbnotes/graph";

/** How many steps are kept, and how many undos can be redone. The oldest go first. */
export const LIMIT = 1000;

/** Where a step happened: its page, and its block when it is about one. */
export type Where = { page: string; block?: string };

/**
 * One step, as the history keeps it: no graph. `events` are what it wrote,
 * and `remembered.inverse` is what taking it back writes. Taking it back
 * the other way writes `events` again, so a redo is exactly the step it
 * redoes, never an undo of its undo: redoing a page delete deletes the page,
 * rather than emptying it block by block.
 */
export type Entry = {
  readonly events: readonly Batched[];
  readonly remembered: Remembered;
  readonly where: Where;
};

/** Which way: back through what was written, or forward through what was undone. */
export type Way = "undo" | "redo";

/** What taking the next step back should do. */
export type Next =
  /** There is no step to take back. */
  | { kind: "nothing" }
  /**
   * Stop here: someone else changed what the step touched since (`changed`),
   * or it cannot be undone (`cannot`). The step stays where it is.
   */
  | { kind: "stopped"; why: "changed" | "cannot"; where: Where }
  /** Write `inverse` as one batch, then tell `taken`. */
  | { kind: "take"; entry: Entry; inverse: Batched[] };

/** A string field of a payload, or undefined. */
function text(payload: unknown, name: string): string | undefined {
  if (typeof payload !== "object" || payload === null || !Object.hasOwn(payload, name)) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Where `events` happened: the first block or page one of them names, as the
 * graph shows it. A block is found after the events, or before them for one
 * they deleted. A page is spelled as the graph after spells it.
 */
function whereOf(before: Graph, after: Graph, events: readonly Batched[]): Where | undefined {
  for (const event of each(events)) {
    const id = text(event.payload, "id");
    const found = id === undefined ? undefined : find(after, id) ?? find(before, id);
    if (id !== undefined && found) return { page: found.page, block: id };
    const page = text(event.payload, "page");
    if (page !== undefined) return { page: titleOf(after, page) };
  }
  return undefined;
}

/**
 * `events`, written on `before` and leading to `after`, as a step to keep:
 * undefined for a write that changed nothing, which is not a step.
 */
export function stepOf(before: Graph, after: Graph, events: readonly Batched[]): Entry | undefined {
  if (after === before || events.length === 0) return undefined;
  const where = whereOf(before, after, events);
  return where && { events, remembered: remember(before, events), where };
}

/**
 * `entry`, taken back by writing `written` on `before`, as the step to keep
 * the other way: taking that back writes what `entry` wrote, again, and
 * holds while what `written` touched is as `written` left it.
 */
export function takenBack(entry: Entry, before: Graph, written: Batched): Entry {
  return {
    events: [written],
    where: entry.where,
    remembered: {
      inverse: [...each(entry.events)],
      expected: remember(before, [written]).expected,
    },
  };
}

/** Both ways for one graph, newest last. */
type Stacks = { undo: Entry[]; redo: Entry[] };

/**
 * A history for every graph this session writes to. `limit` is how many
 * steps each way keeps; the composition root passes `LIMIT`.
 */
export function createHistory<V extends object>(limit: number = LIMIT) {
  let all = new WeakMap<V, Stacks>();

  function of(view: V): Stacks {
    let stacks = all.get(view);
    if (!stacks) all.set(view, (stacks = { undo: [], redo: [] }));
    return stacks;
  }

  /** `entry` on top of `stack`, the oldest dropped past `limit`. */
  function push(stack: Entry[], entry: Entry): void {
    stack.push(entry);
    if (stack.length > limit) stack.splice(0, stack.length - limit);
  }

  return {
    /** A step this session wrote on `view`'s graph. A new step clears redo. */
    record(view: V, entry: Entry): void {
      const stacks = of(view);
      push(stacks.undo, entry);
      stacks.redo.length = 0;
    },

    /**
     * What taking the next step back `way` should do on `now`. A step with
     * nothing left to undo is passed over, and gone; a step that someone
     * else changed, or that cannot be undone, stops it there and stays.
     */
    next(view: V, way: Way, now: Graph): Next {
      const stack = of(view)[way];
      for (;;) {
        const entry = stack.at(-1);
        if (!entry) return { kind: "nothing" };
        const { inverse } = entry.remembered;
        if (inverse === undefined) return { kind: "stopped", why: "cannot", where: entry.where };
        if (!holds(now, entry.remembered)) {
          return { kind: "stopped", why: "changed", where: entry.where };
        }
        if (inverse.length > 0) return { kind: "take", entry, inverse };
        stack.pop();
      }
    },

    /**
     * `entry`, which `next` handed out `way`, was taken back by writing what
     * `done` remembers. `entry` comes off `way`, and `done` goes on the other
     * way, so the undo can be redone and the redo undone.
     */
    taken(view: V, way: Way, entry: Entry, done: Entry): void {
      const stacks = of(view);
      const stack = stacks[way];
      if (stack.at(-1) === entry) stack.pop();
      push(stacks[way === "undo" ? "redo" : "undo"], done);
    },

    /** Every graph's history, gone: the open project changed. */
    forget(): void {
      all = new WeakMap();
    },
  };
}

export type History<V extends object> = ReturnType<typeof createHistory<V>>;
