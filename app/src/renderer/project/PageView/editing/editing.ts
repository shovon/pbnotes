/**
 * What the editing keys in `PageView` do to the page around the box: where
 * the caret goes after Backspace, what Enter in a new box writes, and whether
 * Tab may move a block. Each returns a decision for the view to apply; none
 * names a block, asks main for anything, or touches React.
 *
 * Pure, over the blocks as drawn — main's page with this view's writes in
 * flight folded over it — so the rules run under `node --test`. The reasons
 * behind each rule are on the handler in `PageView.tsx` that applies it.
 */
import { lastLeaf, locate } from '@pbnotes/pages';
import type { Block } from '@pbnotes/pages';
import { placeNew } from '../../placement/placement.ts';

/** A box opened on a block, with the caret this far into its text. */
export type Caret = { editing: string; at: number };

/**
 * Backspace in the empty box of a block that exists.
 *
 * Null: the block has children, and nothing happens — not a delete, not a
 * move. Otherwise the block is deleted, and:
 * - `caret` is the box that opens instead: the block above in reading order,
 *   caret at its end; or, above the page's first block, the block about to
 *   become first, caret at its start; or null with nothing either side.
 * - `openTail`: with nothing either side the page is about to be empty, and
 *   the box at its end opens. Never in a cut, which has no end to write at.
 * - `unzoom`: the block was the zoomed root, so the zoom moves out first, to
 *   what it hung under or, with `to` absent, to the whole page.
 *
 * Read off the page before the delete lands.
 */
export function afterDelete(
  blocks: Block[],
  block: Block,
  { root, reference }: { root?: Block; reference: boolean },
): {
  caret: Caret | null;
  openTail: boolean;
  unzoom?: { to?: string };
} | null {
  if (block.children.length > 0) return null;
  const found = locate(blocks, block.id);
  const above =
    found && found.at > 0
      ? lastLeaf(found.siblings[found.at - 1])
      : found?.parent;
  // Only for the page's first block, guarded on the position so a block the
  // page does not have falls through to neither.
  const below =
    found && found.at === 0 && !found.parent ? blocks[1] : undefined;
  const caret = above
    ? { editing: above.id, at: above.text.length }
    : below
      ? { editing: below.id, at: 0 }
      : null;
  return {
    caret,
    openTail: caret === null && !reference,
    unzoom: block.id === root?.id ? { to: found?.parent?.id } : undefined,
  };
}

/**
 * Backspace in the empty box for a block that does not exist yet: the box
 * closes on the block directly above it on screen, caret at its end — the
 * deepest last child of what the box sits under, of the zoomed root, or of
 * the page's last block. Null when there is no such block and the box stays
 * open: a page with nothing on it, or an `after` the page has no record of.
 */
export function afterCancel(
  blocks: Block[],
  after: string | undefined,
  root?: Block,
): Caret | null {
  const found = after ? locate(blocks, after) : undefined;
  const under = after ? found?.siblings[found.at] : (root ?? blocks.at(-1));
  if (!under) return null;
  const above = lastLeaf(under);
  return { editing: above.id, at: above.text.length };
}

/** What a key in a box for a new block asks for. */
export type Then = 'stop' | 'again' | 'indent' | 'outdent';

/**
 * What a key in the box for a new block writes.
 * - `nothing`: an empty box that was left, which is a click that landed
 *   elsewhere.
 * - `pop`: Enter (or Shift+Tab) on an empty box among a block's children. The
 *   box moves out a level, beside that parent, and nothing is written. Not
 *   past a zoomed root, whose children are the top level of the view.
 * - `write`: a block, placed by `placeNew`, then filed under a bare root when
 *   `indent` says so, then moved a level by `move` for Tab and Shift+Tab — none
 *   for Shift+Tab out of the top level of a zoom, which is out of the view.
 */
export function newBlock(
  blocks: Block[],
  {
    root,
    after: boxAfter,
    text,
    then,
  }: { root?: Block; after?: string; text: string; then: Then },
):
  | { kind: 'nothing' }
  | { kind: 'pop'; after: string }
  | { kind: 'write'; after?: string; indent: boolean; move?: 1 | -1 } {
  const { after, indent } = placeNew(root, boxAfter);
  const parent = after ? locate(blocks, after)?.parent : undefined;
  const top = root !== undefined && (indent || parent?.id === root.id);
  if (!text && (then === 'again' || then === 'outdent') && parent && !top) {
    return { kind: 'pop', after: parent.id };
  }
  if (!text && then === 'stop') return { kind: 'nothing' };
  const move =
    then === 'indent' ? 1 : then === 'outdent' && !top ? -1 : undefined;
  return { kind: 'write', after, indent, move };
}

/**
 * Whether Tab (`by` 1) or Shift+Tab (`by` -1) may move a block that exists.
 * Not one the page does not have, and, zoomed, neither the root itself nor one
 * of its children coming out: either would take the block out of the view it
 * is being written in. A move with nowhere to go — first among its siblings,
 * already at the top level — is the step's to refuse, as main does.
 */
export function movable(
  blocks: Block[],
  id: string,
  by: 1 | -1,
  root?: Block,
): boolean {
  const found = locate(blocks, id);
  if (!found) return false;
  if (!root) return true;
  return id !== root.id && !(by === -1 && found.parent?.id === root.id);
}
