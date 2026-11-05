/**
 * Blocks pasted onto a page (#261): copied blocks written again as new ones,
 * each with an id of the caller's, nested as they were copied. Pure, over
 * the page's blocks as they stand, so main's command and a view drawing the
 * paste ahead of main build the same events.
 */
import { locate } from "../blocks.ts";
import type { Block, Place } from "../blocks.ts";
import type { Batched } from "../../events/batch/batch.ts";
import { blockEdited } from "../../events/blocks/edited/edited.ts";
import { recreate } from "../../events/blocks/created/created.ts";

/**
 * Where a paste goes: a place, as `block.created` means one, or `into` an
 * empty block, which the first pasted block replaces. That block keeps its
 * id and takes the first block's text, the first block's children go after
 * its own, and the rest of the paste follows it as its next siblings.
 */
export type PasteAt = Place | { into: string };

/**
 * The events that write `pasting` on `title` at `at`: the first block at
 * the place and each next one directly beneath the one before, at the same
 * depth, each with its subtree top-down. Undefined when `into` names a block
 * `blocks` lacks.
 */
export function pasted(
  blocks: Block[],
  title: string,
  pasting: readonly Block[],
  at: PasteAt,
): Batched[] | undefined {
  if (pasting.length === 0) return [];
  if ("into" in at) {
    const found = locate(blocks, at.into);
    if (!found) return undefined;
    const target = found.siblings[found.at];
    const [first, ...rest] = pasting;
    return [
      ...(first.text === target.text ? [] : [blockEdited(target.id, first.text)]),
      ...inTurn(title, first.children, {
        parent: target.id,
        ...(target.children.length > 0 ? { after: target.children.at(-1)!.id } : {}),
      }),
      ...inTurn(title, rest, { after: target.id, ...parentOf(found.parent) }),
    ];
  }
  return inTurn(title, pasting, at);
}

/** `parent` as a place field, when there is one. */
const parentOf = (parent: Block | undefined): Place => (parent ? { parent: parent.id } : {});

/**
 * `blocks` one after another from `place`: the first there, each next one
 * beneath the one before, under the same parent.
 */
function inTurn(title: string, blocks: readonly Block[], place: Place): Batched[] {
  return blocks.flatMap((block, at) => {
    const above = blocks[at - 1];
    const here: Place = above
      ? { after: above.id, ...(place.parent ? { parent: place.parent } : {}) }
      : place;
    return recreate(title, block, here);
  });
}
