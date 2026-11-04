/**
 * Undo (#224, #233): the events that take a step back, and whether a step can
 * still be taken back without undoing someone else's work.
 *
 * A step is what one command wrote: the state before it, its events, and the
 * state after. The inverse is plain events, the same ones any writer writes,
 * so every build folds an undo correctly. Nothing here keeps a history; that
 * is the caller's.
 *
 * Nothing here knows what an event means. Each slice says how to undo the
 * events it owns (an `Undo` per event type), and the graph hands the fold and
 * the table of them in. This walks a step and puts the answers together.
 */
import { each } from "../batch/batch.ts";
import type { Batched } from "../batch/batch.ts";

/**
 * Whether one thing a step touched is in `now` as the step left it in
 * `after`.
 */
export type Check<S> = (now: S, after: S) => boolean;

/** How to undo one event type, from the state just before the event. */
export type Undo<S> = {
  /**
   * The events that undo `event`. `[]` when it changed nothing there is to
   * put back; `undefined` when it cannot be undone, which makes its whole step
   * `undefined`, never half undone.
   */
  inverse(state: S, event: Batched): Batched[] | undefined;
  /** What a step must find as it left it, for `event` to be undone. */
  touched(state: S, event: Batched): Check<S>[];
};

/** Event type → how to undo it. */
export type UndoTable<S> = Readonly<Record<string, Undo<S>>>;

/** A fold over one event, which hands back `state` itself for one it does not read. */
export type Reduce<S> = (state: S, event: Batched) => S;

/** What one command wrote, between the state before it and the state after. */
export type Step<S> = {
  readonly before: S;
  readonly events: readonly Batched[];
  readonly after: S;
};

/**
 * The entry for an event that cannot be undone. An event says so with this,
 * never by having no entry.
 */
export const CANNOT: Undo<unknown> = {
  inverse: () => undefined,
  touched: () => [],
};

/** A check that what `read` gives is the same in `now` as in `after`. */
export function same<S>(read: (state: S) => unknown): Check<S> {
  return (now, after) => read(now) === read(after);
}

/**
 * `events` with each batch in place of what it holds, each paired with the
 * state just before it, folded forward with `reduce`. An event the fold
 * passes over (it hands back the same state) changed nothing and is left out.
 */
function walk<S>(reduce: Reduce<S>, before: S, events: readonly Batched[]): [S, Batched][] {
  const out: [S, Batched][] = [];
  let state = before;
  for (const event of each(events)) {
    const next = reduce(state, event);
    if (next !== state) out.push([state, event]);
    state = next;
  }
  return out;
}

/** `table`'s entry for `event`, or `CANNOT` for a type it has none for. */
function entry<S>(table: UndoTable<S>, event: Batched): Undo<S> {
  return Object.hasOwn(table, event.type) ? table[event.type] : CANNOT;
}

/**
 * The events that undo `events`, written on `before`: the last event undone
 * first, each against the state as it stood just before it. A batch is the
 * events it holds. `[]` when nothing in `events` changed anything;
 * `undefined` when any event that did cannot be undone.
 */
export function invert<S>(
  reduce: Reduce<S>,
  table: UndoTable<S>,
  before: S,
  events: readonly Batched[],
): Batched[] | undefined {
  const out: Batched[] = [];
  for (const [state, event] of walk(reduce, before, events).reverse()) {
    const undone = entry(table, event).inverse(state, event);
    if (!undone) return undefined;
    out.push(...undone);
  }
  return out;
}

/**
 * Whether `step` can still be undone in `now`: everything it touched is as it
 * left it. False means someone changed it since, and undoing would undo
 * their work too. Only what the step touched is compared, so a change
 * anywhere else leaves it holding.
 */
export function holds<S>(
  reduce: Reduce<S>,
  table: UndoTable<S>,
  now: S,
  step: Step<S>,
): boolean {
  return walk(reduce, step.before, step.events)
    .flatMap(([state, event]) => entry(table, event).touched(state, event))
    .every((check) => check(now, step.after));
}
