/**
 * The link map (#183): every page as a bubble holding its block outline, and
 * every arrow between any two of them. For the graph view, and nothing else.
 *
 * Throwaway. It lives under its own export, `@pbnotes/graph/link-map`, so it
 * can be deleted whole once the graph has a real interface for this: the
 * folder, and its line in the package's `exports`. Nothing else in the
 * package imports it.
 *
 * ponytail: walks every block per call, like `listPages`. A reverse link
 * index in the fold is the fix, if ledgers get big enough for it to show.
 */
import { listPages } from "../graph.ts";
import type { Graph } from "../graph.ts";
import * as forest from "../forest/forest.ts";
import { keyOf, textOf } from "../blocks/blocks.ts";
import { read } from "../reading/reading.ts";
import { resolver } from "../resolve/resolve.ts";
import { canonicalize } from "../titles/canonicalize.ts";
import * as map from "../immutable/immutable.ts";
import * as set from "../immutable/set.ts";

/** A block in a page's outline, by id, with the blocks under it. */
export type Sub = { id: string; children: Sub[] };

/** One end of an arrow: a page, or a block on it. Pages by the title they show. */
export type End = { page: string; block?: string };

/** What made an arrow: a `[[link]]` or `#tag` in a block, a `((ref))`, or a page tag. */
export type Kind = "link" | "ref" | "tag";

export type Edge = { from: End; to: End; kind: Kind };

export type LinkMap = {
  /** Every page `listPages` lists, A to Z, with its outline. */
  pages: { title: string; blocks: number; icon?: string; forest: Sub[] }[];
  /** Each once: a block linking one page twice is one arrow. */
  edges: Edge[];
};

/**
 * Every page and every arrow, at the end it was written at. Links and tags
 * go to the page they open (aliases resolved); a ref goes to the block, on
 * the page it is on. A link or ref to nothing the project has is left out.
 */
export function getLinkMap(state: Graph): LinkMap {
  const names = resolver(state);
  const listed = listPages(state);
  /** key → title, for every node. */
  const titles = new Map(listed.map(({ title }) => [names.key(title), title]));
  const pageOf = (key: string) => titles.get(names.key(key));

  const edges: Edge[] = [];
  const seen = new Set<string>();
  const add = (from: End, to: End, kind: Kind) => {
    const id = JSON.stringify([from.page, from.block, to.page, to.block, kind]);
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ from, to, kind });
  };

  const outline = (ids: readonly string[], page: string): Sub[] =>
    ids.map((id) => {
      const reading = read(textOf(state, id) ?? "");
      for (const link of reading.links) {
        const to = pageOf(canonicalize(link));
        if (to !== undefined) add({ page, block: id }, { page: to }, "link");
      }
      for (const ref of reading.refs) {
        const on = keyOf(state, ref);
        const to = on === undefined ? undefined : pageOf(on);
        if (to !== undefined) add({ page, block: id }, { page: to, block: ref }, "ref");
      }
      return { id, children: outline(forest.childrenOf(state.forest, id), page) };
    });

  const pages = listed.map(({ title, blocks, icon }) => ({
    title,
    blocks,
    ...(icon === undefined ? {} : { icon }),
    forest: outline(forest.rootsOf(state.forest, canonicalize(title)), title),
  }));

  for (const [key, held] of map.entries(state.tags)) {
    const from = pageOf(key);
    if (from === undefined) continue;
    for (const tag of set.values(held)) {
      const to = pageOf(tag);
      if (to !== undefined && to !== from) add({ page: from }, { page: to }, "tag");
    }
  }

  return { pages, edges };
}

/** A node as it shows: `p:` and a page's title, or `b:` and a block's id. */
export type NodeId = string;

export const pageNode = (title: string): NodeId => `p:${title}`;
export const blockNode = (id: string): NodeId => `b:${id}`;

export type Projected = {
  /** What shows: every page, and the blocks of each open bubble, at every open depth. */
  nodes: { id: NodeId; parent?: NodeId; page: string; block?: string; open: boolean; size: number }[];
  /** Arrows between what shows. `kinds` are what made them; `count` how many there were. */
  edges: { from: NodeId; to: NodeId; kinds: Kind[]; count: number }[];
};

/**
 * What shows when the bubbles in `open` are open, and no others: each arrow's
 * ends lifted to the nearest of their bubbles that shows. An arrow inside
 * one closed bubble is gone; arrows that land on the same two nodes are one.
 * `kinds` drops the arrows of every kind not in it before any of that.
 *
 * A block shows when its page and every block above it are open. `size` is
 * how many blocks a node holds, at every depth.
 */
export function project(
  linkMap: LinkMap,
  open: ReadonlySet<NodeId>,
  kinds: ReadonlySet<Kind> = new Set(["link", "ref", "tag"]),
): Projected {
  const nodes: Projected["nodes"] = [];
  /** Every block → the node it shows as. */
  const shownAs = new Map<string, NodeId>();

  const count = (subs: Sub[]): number => subs.reduce((n, sub) => n + 1 + count(sub.children), 0);
  const hide = (subs: Sub[], as: NodeId) =>
    subs.forEach((sub) => (shownAs.set(sub.id, as), hide(sub.children, as)));
  const show = (subs: Sub[], parent: NodeId, page: string) => {
    for (const sub of subs) {
      const id = blockNode(sub.id);
      const isOpen = open.has(id) && sub.children.length > 0;
      nodes.push({ id, parent, page, block: sub.id, open: isOpen, size: count(sub.children) });
      shownAs.set(sub.id, id);
      if (isOpen) show(sub.children, id, page);
      else hide(sub.children, id);
    }
  };

  for (const page of linkMap.pages) {
    const id = pageNode(page.title);
    const isOpen = open.has(id) && page.forest.length > 0;
    nodes.push({ id, page: page.title, open: isOpen, size: page.blocks });
    if (isOpen) show(page.forest, id, page.title);
    else hide(page.forest, id);
  }

  const lift = (end: End): NodeId =>
    (end.block === undefined ? undefined : shownAs.get(end.block)) ?? pageNode(end.page);

  const merged = new Map<string, Projected["edges"][number]>();
  for (const edge of linkMap.edges) {
    if (!kinds.has(edge.kind)) continue;
    const from = lift(edge.from);
    const to = lift(edge.to);
    if (from === to) continue;
    const id = JSON.stringify([from, to]);
    const held = merged.get(id);
    if (held === undefined) merged.set(id, { from, to, kinds: [edge.kind], count: 1 });
    else {
      held.count++;
      if (!held.kinds.includes(edge.kind)) held.kinds.push(edge.kind);
    }
  }

  return { nodes, edges: [...merged.values()] };
}

/**
 * What each block in `ids` says, for a hover: the Markdown of its first
 * paragraph, or null for an id the project does not have. Pairs, as
 * `getPreviews` has them.
 */
export function getPreviewsOf(state: Graph, ids: readonly string[]): [string, string | null][] {
  return ids.map((id) => {
    const text = textOf(state, id);
    return [id, text === undefined ? null : read(text).preview];
  });
}
