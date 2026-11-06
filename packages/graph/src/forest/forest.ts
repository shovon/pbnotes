/**
 * Ordered trees of ids, in groups, never changed (#276): every write hands
 * back a new forest and leaves the one it was given as it was. Each node is
 * a row (its group and its parent) and each list of children is a row, so a
 * write costs the rows it touches, not a copy of the tree they are in.
 *
 * A node sits in one list: its group's roots, or its parent's children. A
 * node and every node under it are in the same group. A group can stand
 * empty: it is there once something has been placed in it, until it is
 * dropped.
 *
 * Never throws: a write it cannot do (a node already there, a spot naming a
 * node that is not, a move inside the node's own subtree) hands back the
 * forest it was given, so a fold built on it cannot fail a folder's open.
 *
 * Plain data, through `immutable/`, so a forest survives a structured clone.
 * Knows nothing about what the ids or the groups are.
 */
import * as map from "../immutable/immutable.ts";
import type { ImmutableMap } from "../immutable/immutable.ts";

export type Node = { readonly group: string; readonly parent?: string };

export type Forest = {
  /** Every node, by id. */
  readonly nodes: ImmutableMap<Node>;
  /** Group → its top-level ids, in order. A group with none is `[]`. */
  readonly roots: ImmutableMap<readonly string[]>;
  /** Node id → its children's ids, in order. A node with none has no row. */
  readonly children: ImmutableMap<readonly string[]>;
};

/**
 * A place in a forest: directly after a node, at its depth; first or last
 * under a node; or first or last at the top of a group.
 */
export type Spot =
  | { readonly after: string }
  | { readonly under: string; readonly at: "first" | "last" }
  | { readonly group: string; readonly at: "first" | "last" };

const NONE: readonly string[] = Object.freeze([]);

export function empty(): Forest {
  return { nodes: map.empty(), roots: map.empty(), children: map.empty() };
}

// ── Reading ─────────────────────────────────────────────────────────────────

export function node(forest: Forest, id: string): Node | undefined {
  return map.get(forest.nodes, id);
}

export function has(forest: Forest, id: string): boolean {
  return map.has(forest.nodes, id);
}

/** A group's top-level ids, in order: `[]` for one that is not there. */
export function rootsOf(forest: Forest, group: string): readonly string[] {
  return map.get(forest.roots, group) ?? NONE;
}

/** Whether `group` is there, empty or not. */
export function hasGroup(forest: Forest, group: string): boolean {
  return map.has(forest.roots, group);
}

/** Every group that is there, empty or not. */
export function groups(forest: Forest): Iterable<string> {
  return map.keys(forest.roots);
}

/** A node's children, in order: `[]` for a leaf, or a node that is not there. */
export function childrenOf(forest: Forest, id: string): readonly string[] {
  return map.get(forest.children, id) ?? NONE;
}

/** Which list a node is in: its parent's children, or its group's roots. */
function listOf(forest: Forest, at: Node): readonly string[] {
  return at.parent === undefined ? rootsOf(forest, at.group) : childrenOf(forest, at.parent);
}

/** The list `id` is in, and where in it: undefined for a node that is not there. */
export function siblingsOf(forest: Forest, id: string): { list: readonly string[]; at: number } | undefined {
  const it = node(forest, id);
  if (!it) return undefined;
  const list = listOf(forest, it);
  return { list, at: list.indexOf(id) };
}

/** Whether `id` is `root` or anywhere under it. */
export function within(forest: Forest, id: string, root: string): boolean {
  for (let at: string | undefined = id; at !== undefined; at = node(forest, at)?.parent) {
    if (at === root) return true;
  }
  return false;
}

/** `id` and every node under it, depth first, parents before children. */
export function subtree(forest: Forest, id: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    out.push(at);
    for (const child of childrenOf(forest, at)) walk(child);
  };
  if (has(forest, id)) walk(id);
  return out;
}

/** Every node in `group`, depth first, in order. */
export function inGroup(forest: Forest, group: string): string[] {
  return rootsOf(forest, group).flatMap((root) => subtree(forest, root));
}

// ── Writing ─────────────────────────────────────────────────────────────────

function setList(forest: Forest, parent: string | undefined, group: string, list: readonly string[]): Forest {
  if (parent !== undefined) {
    const children = list.length === 0 ? map.remove(forest.children, parent) : map.put(forest.children, parent, list);
    return { ...forest, children };
  }
  return { ...forest, roots: map.put(forest.roots, group, list) };
}

function inserted(list: readonly string[], at: number, id: string): string[] {
  return [...list.slice(0, at), id, ...list.slice(at)];
}

/** The node a spot is beside or under, if it names one. */
const refOf = (spot: Spot) => ("after" in spot ? spot.after : "under" in spot ? spot.under : undefined);

/**
 * Where `spot` is, as the group, the parent and the index a node goes at:
 * undefined for a spot naming a node that is not there.
 */
function resolve(forest: Forest, spot: Spot): { group: string; parent?: string; at: number } | undefined {
  if ("after" in spot) {
    const it = node(forest, spot.after);
    if (!it) return undefined;
    const list = listOf(forest, it);
    return { group: it.group, ...(it.parent === undefined ? {} : { parent: it.parent }), at: list.indexOf(spot.after) + 1 };
  }
  if ("under" in spot) {
    if (!has(forest, spot.under)) return undefined;
    const it = node(forest, spot.under)!;
    return { group: it.group, parent: spot.under, at: spot.at === "first" ? 0 : childrenOf(forest, spot.under).length };
  }
  return { group: spot.group, at: spot.at === "first" ? 0 : rootsOf(forest, spot.group).length };
}

/** `forest` with `id` in the list at `where`, its row written, and its group there. */
function attach(forest: Forest, id: string, where: { group: string; parent?: string; at: number }): Forest {
  const { group, parent, at } = where;
  const row: Node = parent === undefined ? { group } : { group, parent };
  const list = parent === undefined ? rootsOf(forest, group) : childrenOf(forest, parent);
  const next = setList({ ...forest, nodes: map.put(forest.nodes, id, row) }, parent, group, inserted(list, at, id));
  return hasGroup(next, group) ? next : { ...next, roots: map.put(next.roots, group, NONE) };
}

/** `forest` with `id` out of the list it is in. Its row and subtree stay. */
function detach(forest: Forest, id: string): Forest {
  const it = node(forest, id)!;
  const list = listOf(forest, it).filter((other) => other !== id);
  return setList(forest, it.parent, it.group, list);
}

/**
 * A new node at `spot`, with nothing under it: the same forest for an id
 * already there, or a spot naming a node that is not.
 */
export function add(forest: Forest, id: string, spot: Spot): Forest {
  if (has(forest, id)) return forest;
  const where = resolve(forest, spot);
  return where ? attach(forest, id, where) : forest;
}

/**
 * `id`, with everything under it, at `spot`, which is read once `id` is out
 * of its old place. Every node under it takes the group it lands in. The
 * same forest for a node that is not there, a spot naming a node that is
 * not, or a spot inside the node's own subtree.
 */
export function move(forest: Forest, id: string, spot: Spot): Forest {
  const it = node(forest, id);
  const ref = refOf(spot);
  if (!it || (ref !== undefined && (!has(forest, ref) || within(forest, ref, id)))) return forest;
  const detached = detach(forest, id);
  let next = attach(detached, id, resolve(detached, spot)!);
  const group = node(next, id)!.group;
  if (group !== it.group) {
    for (const under of subtree(next, id).slice(1)) {
      next = { ...next, nodes: map.put(next.nodes, under, { ...node(next, under)!, group }) };
    }
  }
  return next;
}

/** `forest` without `id` and everything under it. The same forest for an id not there. */
export function removeTree(forest: Forest, id: string): Forest {
  if (!has(forest, id)) return forest;
  let next = detach(forest, id);
  for (const gone of subtree(forest, id)) {
    next = { ...next, nodes: map.remove(next.nodes, gone), children: map.remove(next.children, gone) };
  }
  return next;
}

/** `forest` without `group` and every node in it. The same forest for a group not there. */
export function dropGroup(forest: Forest, group: string): Forest {
  if (!hasGroup(forest, group)) return forest;
  let next: Forest = forest;
  for (const gone of inGroup(forest, group)) {
    next = { ...next, nodes: map.remove(next.nodes, gone), children: map.remove(next.children, gone) };
  }
  return { ...next, roots: map.remove(next.roots, group) };
}
