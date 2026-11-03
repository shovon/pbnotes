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
  propertyRemoved,
  propertySet,
  tagAdded,
  tagRemoved,
} from '@pbnotes/graph';
import type { Block, PageEvent, PropertyEvent, TagEvent } from '@pbnotes/graph';
import type { Command } from '../../../../shared/graph';

/** An event to draw, and the call that asks main to record it. */
export type Step = [PageEvent | PropertyEvent | TagEvent, () => Promise<unknown>];

/**
 * The one call the steps here make, for a view that hands them its bridge.
 * Whatever it answers is the page's to read: the bridge answers a version,
 * and a stub that answers nothing only means the prediction is dropped at
 * once.
 */
export type StepsGraph = { run(command: Command): Promise<unknown> };

/** A new block, named by the caller, at the end of the page or beneath `after`. */
export function add(
  graph: StepsGraph,
  id: string,
  title: string,
  text: string,
  after?: string,
): Step {
  return [
    blockCreated(title, text, after, id),
    () =>
      graph.run({ type: 'addBlock', id, title, text, ...(after ? { after } : {}) }),
  ];
}

export function edit(graph: StepsGraph, id: string, text: string): Step {
  return [
    blockEdited(id, text),
    () => graph.run({ type: 'editBlock', blockId: id, text }),
  ];
}

export function remove(graph: StepsGraph, id: string): Step {
  return [blockDeleted(id), () => graph.run({ type: 'deleteBlock', blockId: id })];
}

/**
 * Tab on a block, resolved on `blocks` the way main resolves it. Undefined for
 * a block first among its siblings, where there is nothing to move under and
 * nothing is sent.
 */
export function indent(
  graph: StepsGraph,
  blocks: Block[],
  id: string,
): Step | undefined {
  const payload = indented(blocks, id);
  return (
    payload && [
      blockIndented(payload),
      () => graph.run({ type: 'indentBlock', blockId: id }),
    ]
  );
}

/** Shift+Tab on a block. Undefined at the top level, like `indent` at the top. */
export function outdent(
  graph: StepsGraph,
  blocks: Block[],
  id: string,
): Step | undefined {
  const payload = outdented(blocks, id);
  return (
    payload && [
      blockOutdented(payload),
      () => graph.run({ type: 'outdentBlock', blockId: id }),
    ]
  );
}

/** `title`'s `key` is now `value`. */
export function setProperty(
  graph: StepsGraph,
  title: string,
  key: string,
  value: string,
): Step {
  return [
    propertySet(title, key, value),
    () => graph.run({ type: 'setProperty', title, key, value }),
  ];
}

/** `title` no longer has `key`. */
export function removeProperty(graph: StepsGraph, title: string, key: string): Step {
  return [
    propertyRemoved(title, key),
    () => graph.run({ type: 'removeProperty', title, key }),
  ];
}

/** `title` now points to `tag`. */
export function addTag(graph: StepsGraph, title: string, tag: string): Step {
  return [tagAdded(title, tag), () => graph.run({ type: 'addTag', title, tag })];
}

/** `title` no longer points to `tag`. */
export function removeTag(graph: StepsGraph, title: string, tag: string): Step {
  return [tagRemoved(title, tag), () => graph.run({ type: 'removeTag', title, tag })];
}

/**
 * `title`'s `from` becomes `to`, keeping `value`, the value `from` is drawn
 * with. One command and the two events main records for it, in its order:
 * both are drawn, and the call is made once, by whichever step is sent first,
 * so its answer is the answer for both.
 */
export function renameProperty(
  graph: StepsGraph,
  title: string,
  from: string,
  to: string,
  value: string,
): Step[] {
  let sent: Promise<unknown> | undefined;
  const send = () => (sent ??= graph.run({ type: 'renameProperty', title, from, to }));
  return [
    [propertySet(title, to, value), send],
    [propertyRemoved(title, from), send],
  ];
}
