/**
 * Dragging a tab along the strip (#338), as arithmetic over the tabs' boxes.
 * Pure: a box is a left edge and a width, along the strip, in one coordinate
 * the caller picks (the strip's content, so its own scroll is counted).
 * Nothing here knows of tabs or the DOM.
 *
 * While a tab is dragged, the strip keeps its order and draws it moved: the
 * dragged tab where the pointer has taken it, and the tabs it has passed
 * slid over by its width. Letting go is when the order changes.
 */

/** One tab's room along the strip. */
export type Box = { left: number; width: number };

/**
 * The index the tab at `from`, moved `dx` along, lands at: past every other
 * tab whose middle its leading edge has crossed, as a tab in a browser
 * does, so a neighbour gives way once half covered. The leading edge is
 * the right one dragged right, the left one dragged left. Between 0 and the
 * last index.
 */
export function slideTo(boxes: readonly Box[], from: number, dx: number): number {
  const dragged = boxes[from];
  if (!dragged) return from;
  const edge = dragged.left + dx + (dx > 0 ? dragged.width : 0);
  let to = 0;
  boxes.forEach((box, at) => {
    if (at !== from && box.left + box.width / 2 < edge) to++;
  });
  return to;
}

/**
 * How far the tab at `at` is slid while the tab at `from`, `width` wide, is
 * dragged to `to`: over by that width when the dragged tab has passed it,
 * nowhere otherwise. The dragged tab itself follows the pointer instead.
 */
export function shiftOf(at: number, from: number, to: number, width: number): number {
  if (at === from) return 0;
  if (from < to && at > from && at <= to) return -width;
  if (to < from && at >= to && at < from) return width;
  return 0;
}
