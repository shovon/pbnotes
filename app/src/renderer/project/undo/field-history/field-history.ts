/**
 * One open field's own undo history (#247): what was typed, grouped into the
 * steps a person would undo one at a time. Pure, over snapshots of the
 * field's text and selection; the field takes them, and puts back the one
 * an undo hands it.
 *
 * The browser's own undo is never used: Chromium keeps one history for the
 * whole page, cannot say when a field has nothing left to undo, and knows
 * nothing of the graph. When the field closes, this goes with it, and what
 * the field wrote is one step in main's history.
 */

/** The field's text and its selection, at one moment. */
export type Snapshot = { readonly value: string; readonly start: number; readonly end: number };

/** One change to the field, as its `input` event says. */
export type Change = {
  /** Typing adds; deleting takes away. A switch between the two starts a step. */
  readonly kind: "insert" | "delete";
  /** What was inserted, when the event says. */
  readonly data: string | null;
  /** When it happened, in milliseconds. A pause longer than `PAUSE` starts a step. */
  readonly at: number;
  /**
   * A step of its own, apart from the typing either side: a paste, a drop,
   * or an edit the field made itself, such as an auto-closed bracket.
   */
  readonly own?: boolean;
};

/** The step being typed: what the next change has to follow on from to join it. */
type Open = {
  readonly kind: Change["kind"];
  readonly at: number;
  /** Where the caret was left. A change anywhere else starts a step. */
  readonly caret: number;
  readonly own: boolean;
  /** Whether the last thing typed ended a word, so the next word starts a step. */
  readonly wordEnded: boolean;
};

export type FieldHistory = {
  /** What undo goes back to, newest last: the field as it was before each step. */
  readonly past: readonly Snapshot[];
  /** What redo goes forward to, newest last. */
  readonly future: readonly Snapshot[];
  readonly open?: Open;
};

/** How long a pause in typing has to be to start a step, in milliseconds. */
export const PAUSE = 500;

/** A field just opened: nothing to undo or redo. */
export const EMPTY: FieldHistory = { past: [], future: [] };

const space = /\s/;

/** Whether `change`, made on `before`, starts a step rather than joining the open one. */
function starts(open: Open | undefined, before: Snapshot, change: Change): boolean {
  if (!open || change.own || open.own) return true;
  if (change.kind !== open.kind) return true;
  if (change.at - open.at > PAUSE) return true;
  // A selection typed over, or the caret moved since the last change.
  if (before.start !== before.end || before.start !== open.caret) return true;
  // A new word after the space that ended the last one.
  const first = change.data?.[0];
  return change.kind === "insert" && open.wordEnded && first !== undefined && !space.test(first);
}

/**
 * `history` after `change` took the field from `before` to `after`. A change
 * that starts a step keeps `before` to go back to; one that joins the open
 * step keeps nothing new. Either way, what could be redone is gone. A change
 * that left the text as it was is not one.
 */
export function typed(
  history: FieldHistory,
  before: Snapshot,
  after: Snapshot,
  change: Change,
): FieldHistory {
  if (before.value === after.value) return history;
  const last = change.data?.at(-1);
  return {
    past: starts(history.open, before, change) ? [...history.past, before] : history.past,
    future: [],
    open: {
      kind: change.kind,
      at: change.at,
      caret: after.start,
      own: change.own ?? false,
      wordEnded: last !== undefined && space.test(last),
    },
  };
}

/** Whether there is a step to undo. */
export function canUndo(history: FieldHistory): boolean {
  return history.past.length > 0;
}

/** Whether there is a step to redo. */
export function canRedo(history: FieldHistory): boolean {
  return history.future.length > 0;
}

/**
 * The step before `now` undone: the snapshot to put the field back to, and
 * the history after, with `now` to redo. Undefined with nothing to undo. The
 * next change starts a step of its own.
 */
export function undo(
  history: FieldHistory,
  now: Snapshot,
): { history: FieldHistory; to: Snapshot } | undefined {
  const to = history.past.at(-1);
  if (!to) return undefined;
  return { history: { past: history.past.slice(0, -1), future: [...history.future, now] }, to };
}

/** The last undo redone, the same way. Undefined with nothing to redo. */
export function redo(
  history: FieldHistory,
  now: Snapshot,
): { history: FieldHistory; to: Snapshot } | undefined {
  const to = history.future.at(-1);
  if (!to) return undefined;
  return { history: { past: [...history.past, now], future: history.future.slice(0, -1) }, to };
}
