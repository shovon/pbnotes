/**
 * The link map as the simulation and the shaders take it: every page and
 * block one node in one list, parents before children and siblings side by
 * side, so a node's siblings and its children are each one run of indices.
 * Pure: arrays in, arrays out.
 */
import { DATE_PATTERN } from '@pbnotes/graph';
import type { LinkMap, Sub } from '@pbnotes/graph/link-map';

/** A block with nothing under it, in world units. Everything else is sized from it. */
export const LEAF = 1;
/** The smallest a page is, so an empty page is still bigger than a block. */
const PAGE_MIN = 2;
/** How much room children get: their discs' area, times this, is the bubble's. */
const PACK = 1.45;
/** Between two siblings, and between a child and its bubble's rim. */
const GAP = 0.35;
const RIM = 0.6;
/**
 * A page with its blocks not showing: how big it is with nothing pointing at it, a speck,
 * and how much its radius grows with each arrow that does, in a straight line.
 */
const COMPACT_LEAST = 0.6;
const COMPACT_GROWTH = 0.15;
/** How far apart two linked siblings rest, past their radii. */
const REST = 8;

/**
 * Journal days are kept together (an experiment), two ways. Here, each day
 * is sprung to the next one there is, so the days stay in date order:
 * `DAY_STRENGTH` is the spring between two days in a row, one across a gap
 * is weaker by the square root of the gap, and 0 turns it off. And in the
 * physics (`DAY_PULL` in `shaders.ts`), every day is drawn to the middle of
 * all of them, and the days are held clear of the other pages (`groups/`).
 */
export const DAY_STRENGTH = 6;
/** How far apart two days in a row rest, past their radii. */
const DAY_REST = 2;
const DAY_MS = 86_400_000;

/** A spring between two siblings, or a steady pull of a block toward what it points at. */
export const SPRING = 0;
export const PULL = 1;

export const KINDS = { link: 0, ref: 1, tag: 2 } as const;
/** Not an arrow anyone wrote: the line from one journal day to the next, drawn with no head. */
export const DAY_LINE = 3;

export type Flat = {
  count: number;
  /** The first `pages` nodes are the pages, in the order the map lists them. */
  pages: number;
  /** `p:` and a title, or `b:` and a block id: what a node's place is kept under. */
  ids: string[];
  /** The page a node is, or is on. */
  titles: string[];
  /** The block a node is; undefined for a page. */
  blocks: (string | undefined)[];
  /** -1 for a page. */
  parent: Int32Array;
  depth: Uint8Array;
  sibStart: Uint32Array;
  sibCount: Uint32Array;
  childStart: Uint32Array;
  childCount: Uint32Array;
  radius: Float32Array;
  /**
   * A page's radius when its blocks do not show: a speck with nothing
   * pointing at it, and bigger in a straight line with each arrow that does,
   * from another page (its in-degree). No room is kept for what is in it. A
   * block's is its `radius`.
   */
  compact: Float32Array;
  /** 1 for a journal day's page: those are drawn to each other (`shaders.ts`). */
  day: Uint8Array;
  springStart: Uint32Array;
  springCount: Uint32Array;
  /** Four numbers a spring: the other node, `SPRING` or `PULL`, its strength, and how far apart the two rest past their radii. */
  springs: Float32Array;
  /** Four numbers an arrow: from, to, its kind (`KINDS`), nothing. */
  edges: Uint32Array;
};

export function flatten(linkMap: LinkMap): Flat {
  const pages = linkMap.pages.length;
  const ids: string[] = [];
  const titles: string[] = [];
  const blocks: (string | undefined)[] = [];
  const parent: number[] = [];
  const sibStart: number[] = [];
  const sibCount: number[] = [];
  const under: Sub[][] = [];
  const pageAt = new Map<string, number>();
  const blockAt = new Map<string, number>();

  linkMap.pages.forEach((page, i) => {
    ids.push(`p:${page.title}`);
    titles.push(page.title);
    blocks.push(undefined);
    parent.push(-1);
    sibStart.push(0);
    sibCount.push(pages);
    under.push(page.forest);
    pageAt.set(page.title, i);
  });

  const childStart: number[] = [];
  const childCount: number[] = [];
  // `ids` grows as it is walked: breadth first, so each node's children are one run.
  for (let i = 0; i < ids.length; i++) {
    const subs = under[i];
    childStart.push(ids.length);
    childCount.push(subs.length);
    for (const sub of subs) {
      blockAt.set(sub.id, ids.length);
      ids.push(`b:${sub.id}`);
      titles.push(titles[i]);
      blocks.push(sub.id);
      parent.push(i);
      sibStart.push(childStart[i]);
      sibCount.push(subs.length);
      under.push(sub.children);
    }
  }
  const count = ids.length;

  const depth = new Uint8Array(count);
  for (let i = pages; i < count; i++) depth[i] = Math.min(255, depth[parent[i]] + 1);

  // Children come after their parents, so backwards is bottom up.
  const radius = new Float32Array(count);
  const area = new Float64Array(count);
  for (let i = count - 1; i >= 0; i--) {
    const least = i < pages ? PAGE_MIN : LEAF;
    radius[i] = childCount[i] === 0 ? least : Math.max(least, PACK * Math.sqrt(area[i]) + RIM);
    if (parent[i] >= 0) area[parent[i]] += (radius[i] + GAP) ** 2;
  }

  const isUnder = (node: number, above: number) => {
    for (let at = node; at >= 0; at = parent[at]) if (at === above) return true;
    return false;
  };

  const edges: number[] = [];
  /** How many arrows point at each page from another page, wherever on it they land. */
  const into = new Uint32Array(pages);
  /** Sibling pair → how many arrows run between the two. */
  const pairs = new Map<number, number>();
  const pulls = new Set<number>();
  for (const edge of linkMap.edges) {
    const a = edge.from.block === undefined ? pageAt.get(edge.from.page) : blockAt.get(edge.from.block);
    const b = edge.to.block === undefined ? pageAt.get(edge.to.page) : blockAt.get(edge.to.block);
    // An arrow into the bubble it starts in, or out of one to itself, has nowhere to be drawn.
    if (a === undefined || b === undefined || isUnder(a, b) || isUnder(b, a)) continue;
    edges.push(a, b, KINDS[edge.kind], 0);
    // The spring goes between the two bubbles that are siblings: where the ends' ways up meet.
    let u = a;
    let v = b;
    while (depth[u] > depth[v]) u = parent[u];
    while (depth[v] > depth[u]) v = parent[v];
    while (parent[u] !== parent[v]) {
      u = parent[u];
      v = parent[v];
    }
    // Siblings with no parent are two pages: an arrow from one into the other.
    if (parent[v] < 0) into[v]++;
    const pair = Math.min(u, v) * count + Math.max(u, v);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    if (a !== u) pulls.add(a * count + b);
    if (b !== v) pulls.add(b * count + a);
  }

  const compact = Float32Array.from(radius, (full, i) =>
    i < pages ? COMPACT_LEAST + COMPACT_GROWTH * into[i] : full,
  );

  const degree = new Uint32Array(count);
  for (const pair of pairs.keys()) {
    degree[Math.floor(pair / count)]++;
    degree[pair % count]++;
  }
  const held: number[][] = Array.from({ length: count }, (): number[] => []);
  for (const pair of pairs.keys()) {
    const u = Math.floor(pair / count);
    const v = pair % count;
    // As d3 has it: a link is as strong as its less linked end allows, and
    // moves the less linked end more, so a hub is not thrown by each spoke.
    const strength = 1 / Math.min(degree[u], degree[v]);
    const total = degree[u] + degree[v];
    held[u].push(v, SPRING, (strength * 2 * degree[v]) / total, REST);
    held[v].push(u, SPRING, (strength * 2 * degree[u]) / total, REST);
  }
  for (const pull of pulls) held[Math.floor(pull / count)].push(pull % count, PULL, 1, 0);

  // The journal's ribbon: each day to the next there is. Titles sort as dates do.
  const days = linkMap.pages
    .map((page, node) => ({ node, title: page.title, at: Date.parse(`${page.title}T00:00:00Z`) }))
    .filter((day) => DATE_PATTERN.test(day.title) && !Number.isNaN(day.at))
    .sort((a, b) => a.at - b.at);
  const day = new Uint8Array(count);
  for (const it of days) day[it.node] = 1;
  for (let i = 1; DAY_STRENGTH > 0 && i < days.length; i++) {
    const a = days[i - 1];
    const b = days[i];
    const strength = DAY_STRENGTH / Math.sqrt(Math.max(1, Math.round((b.at - a.at) / DAY_MS)));
    held[a.node].push(b.node, SPRING, strength, DAY_REST);
    held[b.node].push(a.node, SPRING, strength, DAY_REST);
    edges.push(a.node, b.node, DAY_LINE, 0);
  }

  const springStart = new Uint32Array(count);
  const springCount = new Uint32Array(count);
  const springs: number[] = [];
  held.forEach((list, i) => {
    springStart[i] = springs.length / 4;
    springCount[i] = list.length / 4;
    for (const it of list) springs.push(it);
  });

  return {
    count,
    pages,
    ids,
    titles,
    blocks,
    parent: Int32Array.from(parent),
    depth,
    sibStart: Uint32Array.from(sibStart),
    sibCount: Uint32Array.from(sibCount),
    childStart: Uint32Array.from(childStart),
    childCount: Uint32Array.from(childCount),
    radius,
    compact,
    day,
    springStart,
    springCount,
    springs: Float32Array.from(springs),
    edges: Uint32Array.from(edges),
  };
}

/**
 * Where each node starts: where it was (`kept`, by id), or a spiral of its
 * siblings around its parent, so nothing starts on top of anything else.
 * Four numbers a node: x, y, and how fast it is moving, which is not at all.
 */
export function place(flat: Flat, kept?: ReadonlyMap<string, readonly [number, number]>): Float32Array {
  const GOLDEN = 2.399963229728653;
  const state = new Float32Array(flat.count * 4);
  // The journal's days start as a spiral of their own, to the right of the other pages',
  // so the two clusters (`groups/`) begin apart and the journal is always on the same side.
  const aside = 9 * Math.sqrt(flat.pages) * 1.5;
  let days = 0;
  for (let i = 0; i < flat.count; i++) {
    const was = kept?.get(flat.ids[i]);
    const above = flat.parent[i];
    let x: number;
    let y: number;
    if (was) [x, y] = was;
    else if (above < 0 && flat.day[i] === 1) {
      x = aside + Math.cos(days * GOLDEN) * 5 * Math.sqrt(days);
      y = Math.sin(days * GOLDEN) * 5 * Math.sqrt(days);
      days++;
    } else {
      const nth = i - flat.sibStart[i];
      // Pages spread wide enough to start clear of one another; blocks fill their bubble.
      const reach = above < 0 ? 9 * Math.sqrt(nth) : flat.radius[above] * 0.7 * Math.sqrt((nth + 0.5) / flat.sibCount[i]);
      x = (above < 0 ? 0 : state[above * 4]) + Math.cos(nth * GOLDEN) * reach;
      y = (above < 0 ? 0 : state[above * 4 + 1]) + Math.sin(nth * GOLDEN) * reach;
    }
    state[i * 4] = x;
    state[i * 4 + 1] = y;
  }
  return state;
}
