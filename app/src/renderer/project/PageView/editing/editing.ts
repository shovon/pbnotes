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
import { lastLeaf, locate } from '@pbnotes/graph';
import type { Block } from '@pbnotes/graph';
import { placeNew } from '../../placement/placement.ts';

/** A box opened on a block, with the caret this far into its text. */
export type Caret = { editing: string; at: number };

/**
 * Where the box for a block that does not exist yet waits. `after` is the
 * block it goes beneath, as its next sibling; `under` is the block it goes
 * under, as its first child (#385). Neither is the end of what is in view.
 * Never both.
 */
export type Box = { after?: string; under?: string };

/**
 * Enter at the end of a block that exists: where the next box opens.
 *
 * Under a block whose children are drawn, as its first child, directly under
 * the caret: beside it, the box would land below the whole subtree, away from
 * where the user was typing. So does the zoomed root, children or not, since
 * beside it would be a sibling nobody can see — first, not last, so it means
 * what Enter means anywhere else. Otherwise beside the block, as the next
 * sibling. Children are always drawn today; a collapsed block, once there is
 * one, is to stay a sibling, read off the same fold state that draws it.
 */
export function afterContinue(block: Block, root?: Block): Box {
  return block.children.length > 0 || block.id === root?.id
    ? { under: block.id }
    : { after: block.id };
}

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
 * Delete Block from a block's menu: the block goes, and every block under it
 * with it, which is what the fold does with a delete. Unlike Backspace it is
 * not typed, so nothing opens in its place; what it changes is what was
 * pointing into what went:
 * - `closeEditing`: the open box is on one of the blocks that went.
 * - `closeNew`: the box for a new block is waiting beneath one of them.
 * - `unzoom`: the zoomed root went, itself or under an ancestor picked from
 *   the breadcrumb. The zoom moves out first, to what the deleted block hung
 *   under or, with `to` absent, to the whole page.
 *
 * Undefined for a block the page does not have. Read off the page before the
 * delete lands.
 */
export function afterRemove(
  blocks: Block[],
  id: string,
  {
    root,
    editing,
    writing,
  }: { root?: Block; editing?: string | null; writing?: Box | null },
):
  | { closeEditing: boolean; closeNew: boolean; unzoom?: { to?: string } }
  | undefined {
  const found = locate(blocks, id);
  if (!found) return undefined;
  const going = new Set(ids(found.siblings[found.at]));
  const gone = (it: string | null | undefined) => it != null && going.has(it);
  return {
    closeEditing: gone(editing),
    closeNew: gone(writing?.after) || gone(writing?.under),
    unzoom: gone(root?.id) ? { to: found.parent?.id } : undefined,
  };
}

/** The ids of `block` and every block under it. */
function ids(block: Block): string[] {
  return [block.id, ...block.children.flatMap(ids)];
}

/**
 * Backspace in the empty box for a block that does not exist yet: the box
 * closes on the block directly above it on screen, caret at its end — the
 * block a first child's box sits under, or else the deepest last child of
 * what the box sits beside, of the zoomed root, or of the page's last block.
 * Null when there is no such block and the box stays open: a page with
 * nothing on it, or a block the page has no record of.
 */
export function afterCancel(
  blocks: Block[],
  { after, under }: Box,
  root?: Block,
): Caret | null {
  if (under) {
    const found = locate(blocks, under);
    const parent = found?.siblings[found.at];
    return parent ? { editing: parent.id, at: parent.text.length } : null;
  }
  const found = after ? locate(blocks, after) : undefined;
  const beside = after ? found?.siblings[found.at] : (root ?? blocks.at(-1));
  if (!beside) return null;
  const above = lastLeaf(beside);
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
 * - `write`: a block, as the first child of `parent` for a box `under` it, or
 *   else placed by `placeNew`, then filed under a bare root when `indent`
 *   says so; then moved a level by `move` for Tab and Shift+Tab — none for
 *   Shift+Tab out of the top level of a zoom, which is out of the view.
 */
export function newBlock(
  blocks: Block[],
  {
    root,
    after: boxAfter,
    under,
    text,
    then,
  }: { root?: Block; text: string; then: Then } & Box,
):
  | { kind: 'nothing' }
  | { kind: 'pop'; after: string }
  | { kind: 'write'; after?: string; parent?: string; indent: boolean; move?: 1 | -1 } {
  const { after, indent } = under ? { after: undefined, indent: false } : placeNew(root, boxAfter);
  const parent = under
    ? locate(blocks, under)?.siblings.find((it) => it.id === under)
    : after
      ? locate(blocks, after)?.parent
      : undefined;
  const top = root !== undefined && (indent || parent?.id === root.id);
  if (!text && (then === 'again' || then === 'outdent') && parent && !top) {
    return { kind: 'pop', after: parent.id };
  }
  if (!text && then === 'stop') return { kind: 'nothing' };
  const move =
    then === 'indent' ? 1 : then === 'outdent' && !top ? -1 : undefined;
  return { kind: 'write', after, ...(under ? { parent: under } : {}), indent, move };
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
