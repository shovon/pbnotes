/**
 * The mouse side of dragging to select (#262): a thin adapter from the
 * window's mouse and key events to `sweep.ts`, which does the arithmetic.
 * Knows nothing of blocks: what a row is, where a press may start and what a
 * sweep selects are handed in by `ProjectView`.
 *
 * Rows are in page coordinates (`clientY` plus the window's scroll), so a run
 * holds still while the page scrolls under the pointer.
 */
import { begins, swept } from './sweep';
import type { Row } from './sweep';

/** Where a press went down, as the caller reads it. */
export type Press = {
  /** The row it went down on, or undefined for a blank area. */
  start: string | undefined;
  /** Whether the drag adds to what is selected (Cmd/Ctrl), rather than replacing it. */
  add: boolean;
};

export type Watched = {
  /** Every row that shows, top to bottom, in page coordinates. */
  rows(): Row[];
  /** What a press is, or undefined when it cannot start a drag. */
  press(event: MouseEvent): Press | undefined;
  /** A drag-select began: what it adds to is fixed now. */
  start(add: boolean): void;
  /** The run the drag covers, from anchor to head, or undefined for none. */
  sweep(run: { anchor: string; head: string } | undefined): void;
  /** Escape during the drag: what it selected is dropped. */
  cancel(): void;
  /** The drag is over, by mouseup or by the window losing the pointer. */
  end(): void;
};

/** How close to the window's top or bottom edge the page starts to scroll. */
const EDGE = 40;

type Held = Press & {
  /** Where it went down, in client coordinates. */
  x: number;
  y: number;
  /** Where it went down, in page coordinates. */
  from: number;
  active: boolean;
  cancelled: boolean;
};

/** Listens on the window until the returned function is called. */
export function watchDrag(on: Watched): () => void {
  let held: Held | null = null;
  let pointer = { x: 0, y: 0 };
  let frame = 0;
  // The click a drag ends with is no click: not an open, not a Cmd+click.
  let swallow = false;
  let userSelect = '';

  const page = (clientY: number) => clientY + window.scrollY;

  /** The anchor's middle, now: a box closing can move it from where it was. */
  const from = (it: Held, rows: Row[]) => {
    const row = it.start === undefined ? undefined : rows.find((r) => r.key === it.start);
    return row ? (row.top + row.bottom) / 2 : it.from;
  };

  const tick = () => {
    frame = 0;
    if (!held?.active) return;
    const near =
      pointer.y < EDGE
        ? pointer.y - EDGE
        : pointer.y > window.innerHeight - EDGE
          ? pointer.y - (window.innerHeight - EDGE)
          : 0;
    if (near !== 0) window.scrollBy(0, Math.round(near / 2));
    const rows = on.rows();
    on.sweep(swept(rows, from(held, rows), page(pointer.y)));
    // Near an edge the page keeps scrolling while the pointer holds still.
    if (near !== 0) frame = requestAnimationFrame(tick);
  };
  const later = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const finish = () => {
    if (!held) return;
    if (held.active || held.cancelled) {
      swallow = true;
      document.documentElement.style.userSelect = userSelect;
      on.end();
    }
    held = null;
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onDown = (event: MouseEvent) => {
    swallow = false;
    if (event.button !== 0) return;
    const it = on.press(event);
    if (!it) return;
    held = { ...it, x: event.clientX, y: event.clientY, from: page(event.clientY), active: false, cancelled: false };
    pointer = { x: event.clientX, y: event.clientY };
  };

  const onMove = (event: MouseEvent) => {
    if (!held || held.cancelled) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!held.active) {
      const moved = Math.hypot(event.clientX - held.x, event.clientY - held.y);
      if (!begins(on.rows(), held.start, page(event.clientY), moved)) return;
      held.active = true;
      // A box the drag started in closes, keeping what was typed, as a
      // blur does; the text it was selecting goes.
      const box = document.activeElement;
      if (box instanceof HTMLTextAreaElement) box.blur();
      window.getSelection()?.removeAllRanges();
      userSelect = document.documentElement.style.userSelect;
      document.documentElement.style.userSelect = 'none';
      on.start(held.add);
    }
    event.preventDefault();
    later();
  };

  const onKey = (event: KeyboardEvent) => {
    if (!held?.active || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    held.active = false;
    held.cancelled = true;
    on.cancel();
  };

  const onClick = (event: MouseEvent) => {
    if (!swallow) return;
    swallow = false;
    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', finish, true);
  window.addEventListener('blur', finish);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('click', onClick, true);
  return () => {
    finish();
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', finish, true);
    window.removeEventListener('blur', finish);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('click', onClick, true);
  };
}
