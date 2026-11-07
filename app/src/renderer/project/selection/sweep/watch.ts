/**
 * The mouse side of dragging to select (#262): a thin adapter from a drag
 * on the window (`gesture/`) to `sweep.ts`, which does the arithmetic.
 * Knows nothing of blocks: what a row is, where a press may start and what a
 * sweep selects are handed in by `Tab`.
 *
 * Rows are in page coordinates (`clientY` plus the window's scroll), so a run
 * holds still while the page scrolls under the pointer.
 */
import { begins, swept } from './sweep';
import type { Row } from './sweep';
import { watchGesture } from '../../gesture/gesture';

/** Where a press went down, as the caller reads it. */
export type Press = {
  /** The row it went down on, or undefined for a blank area. */
  start: string | undefined;
  /** Whether the drag adds to what is selected (Cmd/Ctrl), rather than replacing it. */
  add: boolean;
};

/** A point in client coordinates, as the gesture hands it on. */
type Point = { x: number; y: number };

export type Watched<P extends Press = Press> = {
  /**
   * The rows a drag from `press` can touch, top to bottom, in page
   * coordinates: those of the one column it went down in (#305), so a row
   * beside it at the same height is never taken for one it touched.
   */
  rows(press: P): Row[];
  /** What scrolls near its edges for a drag from `press`: an element, or null for the window. */
  scroller?(press: P, at: Point): Element | null;
  /** What a press is, or undefined when it cannot start a drag. */
  press(event: MouseEvent): P | undefined;
  /** A drag-select began: what it adds to is fixed now. */
  start(add: boolean): void;
  /** The run the drag covers, from anchor to head, or undefined for none. */
  sweep(run: { anchor: string; head: string } | undefined): void;
  /** Escape during the drag: what it selected is dropped. */
  cancel(): void;
  /** The drag is over, by mouseup or by the window losing the pointer. */
  end(): void;
};

/** Where a press went down, kept for the drag it may become. */
type Held<P extends Press> = P & {
  /** Where it went down, in page coordinates. */
  from: number;
};

/** Listens on the window until the returned function is called. */
export function watchDrag<P extends Press>(on: Watched<P>): () => void {
  const page = (clientY: number) => clientY + window.scrollY;

  /** The anchor's middle, now: a box closing can move it from where it was. */
  const from = (it: Held<P>, rows: Row[]) => {
    const row = it.start === undefined ? undefined : rows.find((r) => r.key === it.start);
    return row ? (row.top + row.bottom) / 2 : it.from;
  };

  return watchGesture<Held<P>>({
    press: (event) => {
      const it = on.press(event);
      return it && { ...it, from: page(event.clientY) };
    },
    begins: (held, start, to) =>
      begins(on.rows(held), held.start, page(to.y), Math.hypot(to.x - start.x, to.y - start.y)),
    start: (held) => on.start(held.add),
    move: (held, to) => {
      const rows = on.rows(held);
      on.sweep(swept(rows, from(held, rows), page(to.y)));
    },
    cancel: () => on.cancel(),
    end: () => on.end(),
    scroller: (held, at) => on.scroller?.(held, at) ?? null,
  });
}
