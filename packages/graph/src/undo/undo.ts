/**
 * Undo (#224, #233): the events that take a step back, and whether a step can
 * still be taken back without undoing someone else's work.
 *
 * A step is what one command wrote: its events, on the state before it. It
 * is remembered once, when it is written (#242): the events that undo it, and
 * for each thing it touched, a reading and the value it gave right after. No
 * state is kept, so what a step costs does not grow with the state. The
 * inverse is plain events, the same ones any writer writes, so every build
 * folds an undo correctly. Nothing here keeps a history; that is the caller's.
 *
 * Nothing here knows what an event means. Each slice says how to undo the
 * events it owns (an `Undo` per event type), and the graph hands the fold and
 * the table of them in. This walks a step and puts the answers together.
 */
import { each } from "../batch/batch.ts";
import type { Batched } from "../batch/batch.ts";

/**
 * A reading of one thing a step touched: a value that is the same in two
 * states when that thing is. A step holds while every reading gives on the
 * state now what it gave right after the step.
 *
 * A reading keeps ids, a title or a key, and never the state it was made
 * from: a remembered step holds on to its readings, and a reading that kept
 * the state would keep the whole graph alive (#242). Its values are compared
 * with `===`, so it gives a string, a number, a boolean or `undefined`.
 */
export type Check<S> = (state: S) => unknown;

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

/**
 * A step as it is remembered: what undoes it, and what it has to find to be
 * undone. Holds no state.
 */
export type Remembered<S> = {
  /**
   * The events that undo the step, to be written as one `batch`. `[]` when it
   * changed nothing; `undefined` when it cannot be undone.
   */
  readonly inverse: Batched[] | undefined;
  /** Each reading of what the step touched, and the value it gave right after. */
  readonly expected: readonly (readonly [Check<S>, unknown])[];
};

/**
 * The entry for an event that cannot be undone. An event says so with this,
 * never by having no entry.
 */
export const CANNOT: Undo<unknown> = {
  inverse: () => undefined,
  touched: () => [],
};

/**
 * `read` as a reading of what a step touched: the step holds while it gives
 * the same as it did right after the step. Here so every event's `touched`
 * says what it compares the same way.
 */
export function same<S>(read: (state: S) => unknown): Check<S> {
  return read;
}

/**
 * `events` with each batch in place of what it holds, each paired with the
 * state just before it, folded forward with `reduce`, and the state after the
 * last. An event the fold passes over (it hands back the same state) changed
 * nothing and is left out.
 */
function walk<S>(
  reduce: Reduce<S>,
  before: S,
  events: readonly Batched[],
): { steps: [S, Batched][]; after: S } {
  const steps: [S, Batched][] = [];
  let state = before;
  for (const event of each(events)) {
    const next = reduce(state, event);
    if (next !== state) steps.push([state, event]);
    state = next;
  }
  return { steps, after: state };
}

/** `table`'s entry for `event`, or `CANNOT` for a type it has none for. */
function entry<S>(table: UndoTable<S>, event: Batched): Undo<S> {
  return Object.hasOwn(table, event.type) ? table[event.type] : CANNOT;
}

/** The inverse of the walked `steps`: the last undone first. */
function inverseOf<S>(table: UndoTable<S>, steps: [S, Batched][]): Batched[] | undefined {
  const out: Batched[] = [];
  for (const [state, event] of [...steps].reverse()) {
    const undone = entry(table, event).inverse(state, event);
    if (!undone) return undefined;
    out.push(...undone);
  }
  return out;
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
  return inverseOf(table, walk(reduce, before, events).steps);
}

/**
 * `events`, written on `before`, as a step is remembered: what undoes it, and
 * each reading of what it touched with the value it gives right after. Called
 * once, when the step is written; neither `before` nor any state after it is
 * kept, so both can be let go as soon as this returns.
 */
export function remember<S>(
  reduce: Reduce<S>,
  table: UndoTable<S>,
  before: S,
  events: readonly Batched[],
): Remembered<S> {
  const { steps, after } = walk(reduce, before, events);
  const checks = steps.flatMap(([state, event]) => entry(table, event).touched(state, event));
  return {
    inverse: inverseOf(table, steps),
    expected: checks.map((check) => [check, check(after)] as const),
  };
}

/**
 * Whether a remembered step can still be undone in `now`: every reading gives
 * what it gave right after the step. False means someone changed what it
 * touched since, and undoing it would undo their work too. Only what the step
 * touched is read, so a change anywhere else leaves it holding.
 */
export function holds<S>(now: S, remembered: Remembered<S>): boolean {
  return remembered.expected.every(([check, value]) => check(now) === value);
}
