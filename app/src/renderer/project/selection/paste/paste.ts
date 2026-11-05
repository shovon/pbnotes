/**
 * Blocks pasted from a pbnotes copy (#261): named afresh, and placed. Pure,
 * told how to make an id, so it runs under `node --test`; the views read
 * the clipboard and ask main to write.
 */
import type { Block } from '@pbnotes/graph';
import type { Pasted } from '../../../../shared/graph';
import type { Copied } from '../clip/clip';

/** Where the first pasted block goes, as `pasteBlocks` takes it. */
export type Spot = { after?: string; parent?: string } | { into: string };

/** `blocks` with a new id each, from `newId`, nested as they were. */
export function withIds(blocks: readonly Copied[], newId: () => string): Pasted[] {
  return blocks.map((block) => ({
    id: newId(),
    text: block.text,
    children: withIds(block.children, newId),
  }));
}

/**
 * The end of what is in view: last under the zoomed `root`, after its last
 * child or as its first, or with no zoom the end of the page.
 */
export function endOf(root: Block | undefined): Spot {
  if (!root) return {};
  const last = root.children.at(-1);
  return last ? { after: last.id, parent: root.id } : { parent: root.id };
}

/**
 * Beneath block `id`, at its depth, its subtree before the paste. The zoomed
 * `root` is the exception: beneath it is out of view, so the paste goes at
 * the end of what is in view instead.
 */
export function beneath(id: string, root: Block | undefined): Spot {
  return root?.id === id ? endOf(root) : { after: id };
}
