/**
 * The grid layout: every page in a cell of its own, the most linked in the
 * top left corner and the least in the bottom right. Pure: where each page's
 * cell is, which the physics then holds it to (`HOME` in `shaders.ts`).
 */
import { DAY_LINE } from '../flat/flat.ts';
import type { Flat } from '../flat/flat.ts';

/** How the map is laid out: by its forces, or as the grid. */
export type Layout = 'force' | 'grid';

/**
 * What the grid ranks pages by: every arrow that touches a page, only those
 * that point at it (its in-degree), or only those that leave it (its
 * out-degree).
 */
export type Rank = 'links' | 'in' | 'out';

/** Clear ground between the biggest page and its neighbours, in world units. */
const GAP = 3;

/**
 * The pages, most linked first: by how many arrows touch each, wherever on
 * the page they start or end, counting those in, those out, or both, as `by`
 * says. An arrow within one page counts for nothing, and neither does the
 * journal's own line from day to day. Pages as linked as each other stay in
 * the order the map lists them.
 */
export function ranked(flat: Pick<Flat, 'pages' | 'parent' | 'edges'>, by: Rank = 'links'): number[] {
  const links = new Uint32Array(flat.pages);
  const pageOf = (node: number) => {
    let at = node;
    while (flat.parent[at] >= 0) at = flat.parent[at];
    return at;
  };
  for (let e = 0; e < flat.edges.length; e += 4) {
    if (flat.edges[e + 2] === DAY_LINE) continue;
    const from = pageOf(flat.edges[e]);
    const to = pageOf(flat.edges[e + 1]);
    if (from === to) continue;
    if (by !== 'in') links[from]++;
    if (by !== 'out') links[to]++;
  }
  return Array.from({ length: flat.pages }, (_, page) => page).sort((a, b) => links[b] - links[a] || a - b);
}

/**
 * The first `count` cells of a grid `columns` wide, as column and row, from
 * the top left corner outward: one diagonal after another, back and forth,
 * so each cell is beside the one before it and cells as far from the corner
 * as each other come together.
 */
export function cells(count: number, columns: number): [number, number][] {
  const rows = Math.ceil(count / columns);
  const out: [number, number][] = [];
  for (let diagonal = 0; out.length < count; diagonal++) {
    const first = Math.max(0, diagonal - (rows - 1));
    const last = Math.min(diagonal, columns - 1);
    for (let step = 0; step <= last - first && out.length < count; step++) {
      const column = diagonal % 2 === 0 ? first + step : last - step;
      out.push([column, diagonal - column]);
    }
  }
  return out;
}

/**
 * Where each page's cell is, two numbers a page (x, y), about the origin,
 * ranked as `by` says.
 * The grid is about as wide for its height as the view is (`aspect`), and
 * its cells are big enough for the biggest page as `radius` has them.
 */
export function homes(
  flat: Pick<Flat, 'pages' | 'parent' | 'edges'>,
  radius: Float32Array,
  aspect: number,
  by: Rank = 'links',
): Float32Array {
  const out = new Float32Array(flat.pages * 2);
  if (flat.pages === 0) return out;
  const columns = Math.min(flat.pages, Math.max(1, Math.round(Math.sqrt(flat.pages * aspect))));
  const rows = Math.ceil(flat.pages / columns);
  let biggest = 0;
  for (let page = 0; page < flat.pages; page++) biggest = Math.max(biggest, radius[page]);
  const pitch = biggest * 2 + GAP;
  const at = cells(flat.pages, columns);
  ranked(flat, by).forEach((page, rank) => {
    const [column, row] = at[rank];
    out[page * 2] = (column - (columns - 1) / 2) * pitch;
    out[page * 2 + 1] = (row - (rows - 1) / 2) * pitch;
  });
  return out;
}
