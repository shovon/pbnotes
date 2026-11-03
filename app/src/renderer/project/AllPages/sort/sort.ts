/**
 * The order the All pages list is shown in (#200): by one column, either
 * way. Pure, so it runs under `node --test`.
 */
import type { PageListing } from '@pbnotes/graph';

/** A column the list can be sorted by. */
export type Column = 'title' | 'blocks' | 'references' | 'taggedBy' | 'edited';

export type Sort = { by: Column; descending: boolean };

/** A to Z by title: how the list opens. */
export const INITIAL: Sort = { by: 'title', descending: false };

/**
 * A header clicked: the same column turns round; another starts the way it
 * is most often read. A to Z for titles, most first for counts, newest first
 * for times.
 */
export function toggle(sort: Sort, by: Column): Sort {
  if (sort.by === by) return { by, descending: !sort.descending };
  return { by, descending: by !== 'title' };
}

const byTitle = (a: PageListing, b: PageListing) => a.title.localeCompare(b.title);

/**
 * `pages` in `sort`'s order, ties A to Z by title. A page that never changed
 * has no time, and goes last whichever way the times run: it is not older
 * than the rest, it is unknown.
 */
export function sorted(pages: readonly PageListing[], sort: Sort): PageListing[] {
  const sign = sort.descending ? -1 : 1;
  return [...pages].sort((a, b) => {
    if (sort.by === 'title') return sign * byTitle(a, b);
    const x = a[sort.by];
    const y = b[sort.by];
    if (x === undefined || y === undefined) {
      return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0) || byTitle(a, b);
    }
    return sign * (x - y) || byTitle(a, b);
  });
}
