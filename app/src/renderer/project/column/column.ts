/**
 * The columns a tab shows side by side (#305): the page, and the right
 * sidebar's cards. Each scrolls on its own, and what a drag measures by
 * height alone (the rows a sweep touches, the gap a block drops into) has
 * to be measured in one column, or a row of the page and a row of a card at
 * the same height are taken for each other.
 *
 * A column is a name an element carries (`data-column`); the page is the
 * one with none, `PAGE`. Pure, so it runs under `node --test`; reading the
 * names off the screen is `selection/shown.ts`.
 */

/** The page's column: what has no `data-column` around it. */
export const PAGE = '';

/** The attributes a column's own scrolling element carries. */
export function column(name: string) {
  return { 'data-column': name };
}

/** Of `rows`, those in the column `name`, in the order they came. */
export function inColumn<T extends { column: string }>(rows: readonly T[], name: string): T[] {
  return rows.filter((row) => row.column === name);
}
