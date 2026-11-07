/**
 * Blocks as a tree: what a page is read as, and the walks over one. The fold
 * keeps blocks flat (`blocks.ts`) and builds this shape when a page is read.
 * The renderer walks the page it was sent with these, and a paste builds its
 * events from one, so both read a page the same way.
 */

export type Block = {
  id: string;
  text: string;
  /** Nested beneath this one, in the order they fold. Empty for a leaf. */
  children: Block[];
};

export type Page = {
  /**
   * What names the page: a local `YYYY-MM-DD` for a journal day, otherwise
   * the first spelling the fold saw for it. Case does not matter (see
   * `canonicalize`), but the log keeps each title as it was typed.
   */
  title: string;
  /** In the order they belong on the page, which is the order they fold. */
  blocks: Block[];
};

/**
 * Where a block sits: the array it is in, its index there, and the block it
 * hangs under (undefined at the top level). Exported because the app walks
 * the tree the same way the fold reads it, and two walks that must agree drift.
 */
export function locate(
  blocks: Block[],
  id: string,
  parent?: Block,
): { siblings: Block[]; at: number; parent?: Block } | undefined {
  const at = blocks.findIndex((block) => block.id === id);
  if (at !== -1) return { siblings: blocks, at, parent };
  for (const block of blocks) {
    const hit = locate(block.children, id, block);
    if (hit) return hit;
  }
  return undefined;
}

/** The deepest last descendant: what renders directly above the next block. */
export function lastLeaf(block: Block): Block {
  let last = block;
  while (last.children.length > 0) {
    last = last.children[last.children.length - 1];
  }
  return last;
}

/**
 * `block` spliced in directly after `after`, as its sibling, at whatever depth
 * `after` sits. Undefined when `after` is not in this subtree.
 */
export function beside(
  blocks: Block[],
  after: string,
  block: Block,
): Block[] | undefined {
  const at = blocks.findIndex((it) => it.id === after);
  if (at !== -1) {
    const next = [...blocks];
    next.splice(at + 1, 0, block);
    return next;
  }
  for (let i = 0; i < blocks.length; i++) {
    const children = beside(blocks[i].children, after, block);
    if (!children) continue;
    const next = [...blocks];
    next[i] = { ...blocks[i], children };
    return next;
  }
  return undefined;
}

/** The block and everything under it, gone from wherever it sat. */
export function without(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) => ({ ...block, children: without(block.children, id) }));
}

/** Every id in `blocks`, at every depth. */
export function ids(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => [block.id, ...ids(block.children)]);
}

/**
 * What indenting a block is: filed under the sibling above it. Undefined for
 * a block first among its siblings, or one the page lacks. Here, because
 * whoever predicts a move has to resolve it exactly as whoever records it.
 */
export function indented(blocks: Block[], id: string): { id: string; parent: string } | undefined {
  const found = locate(blocks, id);
  return found && found.at > 0 ? { id, parent: found.siblings[found.at - 1].id } : undefined;
}

/** What outdenting is: directly beneath the block it hangs under. */
export function outdented(blocks: Block[], id: string): { id: string; after: string } | undefined {
  const parent = locate(blocks, id)?.parent;
  return parent ? { id, after: parent.id } : undefined;
}
