/**
 * One function per write `PageView` makes, each pairing the event the write
 * will be recorded as with the call that asks main to record it. The event is
 * built by the same builder main's command writes it with, so what is drawn
 * ahead of main is what main will hold.
 *
 * Each takes only the call it makes: `run`, with the command for its write.
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

/** The one call the steps here make, for a view that hands them its bridge. */
export type StepsPages = Pick<PagesApi, 'run'>;

/** A new block, named by the caller, at the end of the page or beneath `after`. */
export function add(
  pages: StepsPages,
  id: string,
  title: string,
  text: string,
  after?: string,
): Step {
  return [
    blockCreated(title, text, after, id),
    () =>
      pages.run({ type: 'addBlock', id, title, text, ...(after ? { after } : {}) }),
  ];
}

export function edit(pages: StepsPages, id: string, text: string): Step {
  return [
    blockEdited(id, text),
    () => pages.run({ type: 'editBlock', blockId: id, text }),
  ];
}

export function remove(pages: StepsPages, id: string): Step {
  return [blockDeleted(id), () => pages.run({ type: 'deleteBlock', blockId: id })];
}

/**
 * Tab on a block, resolved on `blocks` the way main resolves it. Undefined for
 * a block first among its siblings, where there is nothing to move under and
 * nothing is sent.
 */
export function indent(
  pages: StepsPages,
  blocks: Block[],
  id: string,
): Step | undefined {
  const payload = indented(blocks, id);
  return (
    payload && [
      blockIndented(payload),
      () => pages.run({ type: 'indentBlock', blockId: id }),
    ]
  );
}

/** Shift+Tab on a block. Undefined at the top level, like `indent` at the top. */
export function outdent(
  pages: StepsPages,
  blocks: Block[],
  id: string,
): Step | undefined {
  const payload = outdented(blocks, id);
  return (
    payload && [
      blockOutdented(payload),
      () => pages.run({ type: 'outdentBlock', blockId: id }),
    ]
  );
}
