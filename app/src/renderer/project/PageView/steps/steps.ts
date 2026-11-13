/**
 * One function per write `PageView` makes, each pairing the event the write
 * will be recorded as with the call that asks main to record it. The event is
 * built by the same builder main's command writes it with, so what is drawn
 * ahead of main is what main will hold.
 *
 * Each takes only the call it makes: `run`, with the command for its write.
 */
import {
  aliasAdded,
  aliasRemoved,
  batch,
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockOutdented,
  iconRemoved,
  iconSet,
  indented,
  outdented,
  propertyRemoved,
  propertySet,
  tagAdded,
  tagRemoved,
} from '@pbnotes/graph';
import type {
  AliasEvent,
  BatchEvent,
  Block,
  IconEvent,
  PageEvent,
  PropertyEvent,
  TagEvent,
} from '@pbnotes/graph';
import type { Command } from '../../../../shared/graph';

/** An event to draw, and the call that asks main to record it. */
export type Step = [
  PageEvent | PropertyEvent | TagEvent | AliasEvent | IconEvent | BatchEvent,
  () => Promise<unknown>,
];

/**
 * The one call the steps here make, for a view that hands them its bridge.
 * Whatever it answers is the page's to read: the bridge answers a version,
 * and a stub that answers nothing only means the prediction is dropped at
 * once.
 */
export type StepsGraph = { run(command: Command): Promise<unknown> };

/**
 * A new block, named by the caller, at the end of the page, beneath `after`,
 * or, with `parent` alone, as that block's first child (#385).
 */
export function add(
  graph: StepsGraph,
  id: string,
  title: string,
  text: string,
  after?: string,
  parent?: string,
): Step {
  return [
    blockCreated(title, text, after, id, parent),
    () =>
      graph.run({
        type: 'addBlock',
        id,
        title,
        text,
        ...(after ? { after } : {}),
        ...(parent ? { parent } : {}),
      }),
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

/** `title` now answers to `alias` (#383). */
export function addAlias(graph: StepsGraph, title: string, alias: string): Step {
  return [aliasAdded(title, alias), () => graph.run({ type: 'addAlias', title, alias })];
}

/** `title` no longer answers to `alias`. */
export function removeAlias(graph: StepsGraph, title: string, alias: string): Step {
  return [aliasRemoved(title, alias), () => graph.run({ type: 'removeAlias', title, alias })];
}

/** `title`'s icon is now `icon` (#323). */
export function setIcon(graph: StepsGraph, title: string, icon: string): Step {
  return [iconSet(title, icon), () => graph.run({ type: 'setIcon', title, icon })];
}

/** `title` has no icon. */
export function removeIcon(graph: StepsGraph, title: string): Step {
  return [iconRemoved(title), () => graph.run({ type: 'removeIcon', title })];
}

/**
 * `title`'s `from` becomes `to`, keeping `value`, the value `from` is drawn
 * with: the one batch main records it as (#225).
 */
export function renameProperty(
  graph: StepsGraph,
  title: string,
  from: string,
  to: string,
  value: string,
): Step {
  return [
    batch([propertySet(title, to, value), propertyRemoved(title, from)]),
    () => graph.run({ type: 'renameProperty', title, from, to }),
  ];
}
