/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockOutdented,
  propertyRemoved,
  propertySet,
  tagAdded,
  tagRemoved,
} from '@pbnotes/graph';
import type { Block } from '@pbnotes/graph';
import {
  add,
  addTag,
  edit,
  indent,
  outdent,
  remove,
  removeProperty,
  removeTag,
  renameProperty,
  setProperty,
} from './steps.ts';
import type { Step } from './steps.ts';
import type { Command } from '../../../../shared/graph.ts';

/** The commands a step sent, in place of main. */
function bridge() {
  const calls: Command[] = [];
  return {
    calls,
    run: async (command: Command): Promise<void> => {
      calls.push(command);
    },
  };
}

const block = (id: string, children: Block[] = []): Block => ({
  id,
  text: id,
  children,
});

/** `a`, then `b` with `c` under it. */
const blocks = [block('a'), block('b', [block('c')])];

/** What a step draws, and what its call sent. */
async function run(graph: ReturnType<typeof bridge>, step: Step | undefined) {
  assert.ok(step);
  const [event, send] = step;
  await send();
  return { event, calls: graph.calls };
}

test('each step draws the event main writes, and sends the write that records it', async () => {
  const graph = bridge();
  const cases: [Step | undefined, unknown, Command][] = [
    [add(graph, 'n', 'Mira', 'hi', 'a'), blockCreated('Mira', 'hi', 'a', 'n'), { type: 'addBlock', id: 'n', title: 'Mira', text: 'hi', after: 'a' }],
    [add(graph, 'n', 'Mira', 'hi'), blockCreated('Mira', 'hi', undefined, 'n'), { type: 'addBlock', id: 'n', title: 'Mira', text: 'hi' }],
    [edit(graph, 'a', 'A!'), blockEdited('a', 'A!'), { type: 'editBlock', blockId: 'a', text: 'A!' }],
    [remove(graph, 'a'), blockDeleted('a'), { type: 'deleteBlock', blockId: 'a' }],
    [indent(graph, blocks, 'b'), blockIndented({ id: 'b', parent: 'a' }), { type: 'indentBlock', blockId: 'b' }],
    [outdent(graph, blocks, 'c'), blockOutdented({ id: 'c', after: 'b' }), { type: 'outdentBlock', blockId: 'c' }],
    [setProperty(graph, 'Mira', 'Status', 'done'), propertySet('Mira', 'Status', 'done'), { type: 'setProperty', title: 'Mira', key: 'Status', value: 'done' }],
    [removeProperty(graph, 'Mira', 'Status'), propertyRemoved('Mira', 'Status'), { type: 'removeProperty', title: 'Mira', key: 'Status' }],
    [addTag(graph, 'Mira', 'Work'), tagAdded('Mira', 'Work'), { type: 'addTag', title: 'Mira', tag: 'Work' }],
    [removeTag(graph, 'Mira', 'Work'), tagRemoved('Mira', 'Work'), { type: 'removeTag', title: 'Mira', tag: 'Work' }],
  ];
  for (const [step, built, call] of cases) {
    graph.calls.length = 0;
    const { event, calls } = await run(graph, step);
    assert.deepEqual(event, built);
    assert.deepEqual(calls, [call]);
  }
});

test('a move with nowhere to go is no step at all', () => {
  const graph = bridge();
  assert.equal(indent(graph, blocks, 'a'), undefined);
  assert.equal(indent(graph, blocks, 'c'), undefined);
  assert.equal(outdent(graph, blocks, 'a'), undefined);
  assert.equal(indent(graph, blocks, 'nope'), undefined);
});

test('a rename draws both its events and sends its one command once', async () => {
  const calls: Command[] = [];
  const graph = {
    run: async (command: Command) => {
      calls.push(command);
      return 7;
    },
  };
  const steps = renameProperty(graph, 'Mira', 'Owner', 'Author', 'Sal');
  assert.deepEqual(
    steps.map(([event]) => event),
    [propertySet('Mira', 'Author', 'Sal'), propertyRemoved('Mira', 'Owner')],
  );
  const answers = [];
  for (const [, send] of steps) answers.push(await send());
  assert.deepEqual(answers, [7, 7]);
  assert.deepEqual(calls, [{ type: 'renameProperty', title: 'Mira', from: 'Owner', to: 'Author' }]);
});
