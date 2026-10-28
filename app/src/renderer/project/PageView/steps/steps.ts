/**
 * One function per write `PageView` makes, each pairing the event the write
 * will be recorded as with the call that asks main to record it. The event is
 * built by the same builder main's command writes it with, so what is drawn
 * ahead of main is what main will hold.
 *
 * Each takes only the call it makes.
 */
import {
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockOutdented,
  indented,
  outdented,
} from '@pbnotes/pages';
import type { Block, PageEvent } from '@pbnotes/pages';
import type { PagesApi } from '../../../../shared/pages';

/** An event to draw, and the call that asks main to record it. */
export type Step = [PageEvent, () => Promise<unknown>];

/** A new block, named by the caller, at the end of the page or beneath `after`. */
export function add(
  pages: Pick<PagesApi, 'addBlock'>,
  id: string,
  title: string,
  text: string,
  after?: string,
): Step {
  return [
    blockCreated(title, text, after, id),
    () => pages.addBlock(id, title, text, after),
  ];
}

export function edit(
  pages: Pick<PagesApi, 'editBlock'>,
  id: string,
  text: string,
): Step {
  return [blockEdited(id, text), () => pages.editBlock(id, text)];
}

export function remove(pages: Pick<PagesApi, 'deleteBlock'>, id: string): Step {
  return [blockDeleted(id), () => pages.deleteBlock(id)];
}

/**
 * Tab on a block, resolved on `blocks` the way main resolves it. Undefined for
 * a block first among its siblings, where there is nothing to move under and
 * nothing is sent.
 */
export function indent(
  pages: Pick<PagesApi, 'indentBlock'>,
  blocks: Block[],
  id: string,
): Step | undefined {
  const payload = indented(blocks, id);
  return payload && [blockIndented(payload), () => pages.indentBlock(id)];
}

/** Shift+Tab on a block. Undefined at the top level, like `indent` at the top. */
export function outdent(
  pages: Pick<PagesApi, 'outdentBlock'>,
  blocks: Block[],
  id: string,
): Step | undefined {
  const payload = outdented(blocks, id);
  return payload && [blockOutdented(payload), () => pages.outdentBlock(id)];
}
