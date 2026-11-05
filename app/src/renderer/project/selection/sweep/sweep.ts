/**
 * Dragging across blocks to select them (#262), as arithmetic over rows. Pure,
 * and generic: a row is a key and the span it covers along the line a drag
 * runs down, in one coordinate the caller picks. Nothing here knows of
 * blocks, the DOM or scrolling; `watch.ts` reads the rows off the screen and
 * hands them in.
 *
 * Rows are in the order they show, which is top to bottom, so what a drag
 * touches is always one unbroken run of them.
 */

/** One row a drag can touch: its own span, not what shows under it. */
export type Row = { key: string; top: number; bottom: number };

/** How far a press from a blank area moves before it is a drag, not a click. */
export const THRESHOLD = 4;

/** The key of the row at `at`, or undefined in a gap or past either end. */
export function rowAt(rows: readonly Row[], at: number): string | undefined {
  return rows.find((row) => at >= row.top && at <= row.bottom)?.key;
}

/**
 * Whether a press has become a drag-select. From a blank area (`start`
 * undefined), once it has moved `THRESHOLD` from where it went down. From a
 * row, once the pointer is over another row: until then a drag in a row
 * selects its text, and a gap between rows is no row.
 */
export function begins(
  rows: readonly Row[],
  start: string | undefined,
  at: number,
  moved: number,
): boolean {
  if (start === undefined) return moved >= THRESHOLD;
  const over = rowAt(rows, at);
  return over !== undefined && over !== start;
}

/**
 * The run a drag from `from` to `to` selects: every row whose span the
 * dragged stretch touches, from the anchor (the row the drag started on, or
 * the one nearest it when it started in a gap) to the head (the far end).
 * Undefined when it touches none.
 */
export function swept(
  rows: readonly Row[],
  from: number,
  to: number,
): { anchor: string; head: string } | undefined {
  const [low, high] = from <= to ? [from, to] : [to, from];
  const touched = rows.filter((row) => row.bottom >= low && row.top <= high);
  if (touched.length === 0) return undefined;
  const first = touched[0].key;
  const last = touched[touched.length - 1].key;
  const down = to >= from;
  return { anchor: rowAt(touched, from) ?? (down ? first : last), head: down ? last : first };
}
