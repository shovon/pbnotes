/**
 * Where a new block goes. Shared by the two places that add blocks without a
 * box saying where: `PageView`'s box at the end of what is in view, and
 * `ProjectView`'s pasted or dropped images.
 *
 * Pure, over the blocks as drawn, so the rules run under `node --test` with
 * nothing around them. The views make the id, ask main to write, and draw.
 */
import { locate, canonicalize } from '@pbnotes/pages';
import type { Block, Page } from '@pbnotes/pages';

/**
 * Where a block goes, and whether it takes a second step to get there.
 * `after` is the block it is written beneath, and absent for the end of the
 * page. `indent` is a root with no children yet: the block is written beside
 * the root, then filed under it, since nothing can be written under a block
 * as a first child.
 */
export type Placement = { after?: string; indent: boolean };

/**
 * A new block beneath `after` when there is one to go beneath — the box opened
 * under a block, or the image written just before this one. Otherwise last in
 * what is in view: last under the zoomed `root`, or, with no zoom, at the end
 * of the page.
 */
export function placeNew(root: Block | undefined, after?: string): Placement {
  if (after !== undefined) return { after, indent: false };
  if (!root) return { indent: false };
  return {
    after: root.children.at(-1)?.id ?? root.id,
    indent: root.children.length === 0,
  };
}

/**
 * The page a paste or a drop with no box open lands on, and the block it goes
 * under: the page dropped on, else the one showing, else today. Under the
 * zoomed block only when it lands on the zoomed page — a drop on another day
 * in view goes at the end of that day.
 *
 * Matched by `canonicalize`: the trail holds the title as the link spelt it, and
 * the page shows the spelling it was first given.
 */
export function imageTarget({
  dropped,
  title,
  today,
  showing,
  zoom,
}: {
  /** The `data-page` of what was dropped on, if anything. */
  dropped?: string;
  /** The page the trail ends on, or null for the journal. */
  title: string | null;
  today: string;
  showing: Page[];
  zoom?: string;
}): { page: string; root?: Block } {
  const page = dropped ?? title ?? today;
  const shown = showing.find((it) => canonicalize(it.title) === canonicalize(page));
  const found =
    zoom && title !== null && canonicalize(page) === canonicalize(title) && shown
      ? locate(shown.blocks, zoom)
      : undefined;
  return { page, root: found?.siblings[found.at] };
}
