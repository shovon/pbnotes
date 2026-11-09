/**
 * A mouse drag on the window, with nothing said about what is dragged: a
 * press that may become a drag, the drag's moves, Escape to cancel it, and
 * its end. Dragging to select (#262) and dragging a block to move it (#251)
 * are each a thin layer over this.
 *
 * While a drag is on: text is not selected, a box it started from is
 * blurred (keeping what was typed), what the drag is over scrolls when the
 * pointer nears its top or bottom edge (the window, or a column that scrolls
 * on its own, #305), and the click a drag ends with is swallowed, so it
 * neither opens nor follows anything.
 */

/** A pointer position, in client coordinates. */
export type Point = { x: number; y: number };

export type Gesture<P> = {
  /** What a press is, or undefined when it cannot start a drag. */
  press(event: MouseEvent): P | undefined;
  /** Whether a press has become a drag, now that the pointer is at `to`. */
  begins(press: P, from: Point, to: Point): boolean;
  /** The drag began. */
  start(press: P): void;
  /** The pointer is at `to`, or the page scrolled under it. */
  move(press: P, to: Point): void;
  /** Escape during the drag. Nothing else is said about this drag. */
  cancel(press: P): void;
  /** The drag is over: let go of (`dropped`), or the window lost the pointer. */
  end(press: P, dropped: boolean): void;
  /**
   * What scrolls near its edges while the pointer is at `at`: an element
   * that scrolls on its own, or null (or left out) for the window.
   */
  scroller?(press: P, at: Point): Element | null;
  /**
   * Which way it scrolls: down and up (`y`, the default), or along (`x`),
   * near the scroller's left and right edges, as a strip of tabs does
   * (#338). Along, the window never scrolls: only a scroller handed in.
   */
  axis?: 'x' | 'y';
};

/** How close to the top or bottom edge of what scrolls it starts to scroll. */
const EDGE = 40;

/**
 * How far past an edge zone `y` is, in a box from `top` to `bottom`: below
 * zero near the top, above zero near the bottom, and zero away from both.
 */
export function nearEdge(y: number, top: number, bottom: number, edge = EDGE): number {
  if (y < top + edge) return y - (top + edge);
  if (y > bottom - edge) return y - (bottom - edge);
  return 0;
}

type Held<P> = { press: P; from: Point; active: boolean; cancelled: boolean };

/** Listens on the window until the returned function is called. */
export function watchGesture<P>(on: Gesture<P>): () => void {
  let held: Held<P> | null = null;
  let pointer: Point = { x: 0, y: 0 };
  let frame = 0;
  // The click a drag ends with is no click: not an open, not a Cmd+click.
  let swallow = false;
  let userSelect = '';

  const tick = () => {
    frame = 0;
    if (!held?.active) return;
    const scroller = on.scroller?.(held.press, pointer) ?? null;
    let near = 0;
    if (on.axis === 'x') {
      if (scroller) {
        const { left, right } = scroller.getBoundingClientRect();
        near = nearEdge(pointer.x, left, right);
        if (near !== 0) scroller.scrollBy(Math.round(near / 2), 0);
      }
    } else {
      const { top, bottom } = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      near = nearEdge(pointer.y, top, bottom);
      if (near !== 0) (scroller ?? window).scrollBy(0, Math.round(near / 2));
    }
    on.move(held.press, pointer);
    // Near an edge the page keeps scrolling while the pointer holds still.
    if (near !== 0) frame = requestAnimationFrame(tick);
  };
  const later = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const finish = (dropped: boolean) => {
    if (!held) return;
    if (held.active || held.cancelled) {
      swallow = true;
      document.documentElement.style.userSelect = userSelect;
    }
    if (held.active) on.end(held.press, dropped);
    held = null;
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onDown = (event: MouseEvent) => {
    swallow = false;
    if (event.button !== 0) return;
    const press = on.press(event);
    if (press === undefined) return;
    pointer = { x: event.clientX, y: event.clientY };
    held = { press, from: pointer, active: false, cancelled: false };
  };

  const onMove = (event: MouseEvent) => {
    if (!held || held.cancelled) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!held.active) {
      if (!on.begins(held.press, held.from, pointer)) return;
      held.active = true;
      // A box the drag started in closes, keeping what was typed, as a
      // blur does; the text it was selecting goes.
      const box = document.activeElement;
      if (box instanceof HTMLTextAreaElement) box.blur();
      window.getSelection()?.removeAllRanges();
      userSelect = document.documentElement.style.userSelect;
      document.documentElement.style.userSelect = 'none';
      on.start(held.press);
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
    on.cancel(held.press);
  };

  const onClick = (event: MouseEvent) => {
    if (!swallow) return;
    swallow = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onUp = () => finish(true);
  const onBlur = () => finish(false);

  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('click', onClick, true);
  return () => {
    finish(false);
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('click', onClick, true);
  };
}
