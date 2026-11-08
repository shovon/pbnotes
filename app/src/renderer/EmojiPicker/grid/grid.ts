/**
 * Moving through the picker's grid with the arrow keys (#325). The emoji
 * are numbered in the order they show, section after section, and each
 * section starts a new row, so its last row can be short. Pure: sizes in,
 * a number out.
 */

/** The rows the cells fall into: each row its first cell and how many it holds. */
export type Rows = readonly { readonly start: number; readonly length: number }[];

/** The rows for sections of `sizes` cells each, `columns` to a row. */
export function rowsOf(sizes: readonly number[], columns: number): Rows {
  const rows: { start: number; length: number }[] = [];
  let start = 0;
  for (const size of sizes) {
    for (let at = 0; at < size; at += columns) {
      rows.push({ start: start + at, length: Math.min(columns, size - at) });
    }
    start += size;
  }
  return rows;
}

/** The key names that move. */
export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * The cell an arrow moves to from `index`. Left and Right go one cell along
 * the order, across rows. Up and Down go a row, to the same column or the
 * last cell of a shorter row. It stops at either end rather than wrap.
 */
export function move(rows: Rows, index: number, arrow: Arrow): number {
  const count = rows.reduce((n, row) => n + row.length, 0);
  if (count === 0) return 0;
  const at = Math.min(Math.max(index, 0), count - 1);
  if (arrow === 'ArrowLeft') return Math.max(at - 1, 0);
  if (arrow === 'ArrowRight') return Math.min(at + 1, count - 1);
  const row = rows.findIndex((it) => at < it.start + it.length);
  const to = rows[row + (arrow === 'ArrowDown' ? 1 : -1)];
  if (!to) return at;
  return to.start + Math.min(at - rows[row].start, to.length - 1);
}
