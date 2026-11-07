/**
 * Where a dragged block lands (#251), as arithmetic over the rows on screen.
 * Pure: the rows, the pointer and the block being dragged go in, and out
 * comes the page and place a move names, with where to draw the line that
 * shows it. Nothing here reads the DOM; `ProjectView` reads the rows and
 * hands them in.
 *
 * The pointer's height picks the gap between two rows, and how far right it
 * is picks the depth, within what that gap allows: no shallower than the row
 * below it, and no deeper than one under the row above it.
 */

/** One block's own row on screen, in page coordinates. */
export type Row = {
  /** Its slot: the block in one view. */
  key: string;
  /** The view it shows in. Rows of one view are a tree; the next view is another. */
  scope: string;
  /** The page the block is on. */
  page: string;
  /** The block. */
  id: string;
  /** The slot of the row it shows under, if any, in the same view. */
  parent?: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /**
   * Whether its view shows the whole page, so its top rows are the page's
   * top level: a page or a day, not a zoom or a linked reference.
   */
  whole: boolean;
};

/** A page with no blocks yet, where a drop is the first write to it. */
export type Empty = { page: string; top: number; bottom: number; left: number; right: number };

/** Where a block goes, as `moveBlock` names it. */
export type Place = { after?: string; parent?: string; first?: true };

/** A drop: where the block goes, and the line that shows where. */
export type Drop = {
  page: string;
  /** The view the drop is in, or undefined for a page with no blocks yet. */
  scope?: string;
  place: Place;
  line: { top: number; left: number; right: number };
};

/** How far above or below a row the pointer still counts as on it. */
export const SLACK = 8;

/**
 * Where a drop of the blocks `moving` at `x`, `y` lands, or undefined where
 * it lands nowhere: away from every row, over one of their subtrees, or
 * above the first row of a view that is not a whole page, which has no place
 * to name. `indent` is how far one level is from the next.
 *
 * Every row of what is moving is left out first, wherever it shows, so a
 * gap closes over them: a drop never lands beside one of them (#269).
 */
export function dropAt(
  rows: readonly Row[],
  empties: readonly Empty[],
  moving: ReadonlySet<string>,
  x: number,
  y: number,
  indent: number,
): Drop | undefined {
  const empty = empties.find((it) => y >= it.top - SLACK && y <= it.bottom + SLACK);
  if (empty) {
    const { page, top, left, right } = empty;
    return { page, place: {}, line: { top, left, right } };
  }

  const byKey = new Map(rows.map((row) => [row.key, row]));
  const up = (row: Row) => (row.parent === undefined ? undefined : byKey.get(row.parent));
  const depth = (row: Row) => {
    let n = 0;
    for (let it = up(row); it; it = up(it)) n++;
    return n;
  };
  // The blocks and their subtrees are where they are not going.
  const inside = (row: Row) => {
    for (let it: Row | undefined = row; it; it = up(it)) if (moving.has(it.id)) return true;
    return false;
  };
  const kept = rows.filter((row) => !inside(row));

  const over = nearest(kept, y);
  if (!over) return undefined;
  const at = kept.indexOf(over);
  const same = (it: Row | undefined) => (it?.scope === over.scope ? it : undefined);
  const before = y < (over.top + over.bottom) / 2;
  const prev = before ? same(kept[at - 1]) : over;
  const next = before ? over : same(kept[at + 1]);

  if (!prev) {
    // Above the first row of a view: only a whole page has a top to go to.
    if (!over.whole) return undefined;
    return {
      page: over.page,
      scope: over.scope,
      place: { first: true },
      line: { top: over.top, left: over.left, right: over.right },
    };
  }

  const deepest = depth(prev) + 1;
  const shallowest = next ? depth(next) : 0;
  const base = prev.left - depth(prev) * indent;
  const wanted = Math.floor((x - base) / indent);
  const level = Math.min(deepest, Math.max(shallowest, wanted));
  const line = {
    top: next ? (prev.bottom + next.top) / 2 : prev.bottom,
    left: base + level * indent,
    right: prev.right,
  };
  const { page, scope } = prev;
  if (level === deepest) return { page, scope, place: { parent: prev.id }, line };

  let sibling = prev;
  for (let d = depth(prev); d > level; d--) sibling = up(sibling) ?? sibling;
  const parent = up(sibling)?.id;
  return {
    page,
    scope,
    place: { after: sibling.id, ...(parent === undefined ? {} : { parent }) },
    line,
  };
}

/** The row at `y`, or the nearest one within `SLACK` of it. */
function nearest(rows: readonly Row[], y: number): Row | undefined {
  let best: Row | undefined;
  let gap = SLACK;
  for (const row of rows) {
    const off = y < row.top ? row.top - y : y > row.bottom ? y - row.bottom : 0;
    if (off <= gap) {
      best = row;
      gap = off;
      if (off === 0) break;
    }
  }
  return best;
}
