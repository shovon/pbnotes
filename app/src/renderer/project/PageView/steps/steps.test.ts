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
} from '@pbnotes/pages';
import type { Block } from '@pbnotes/pages';
import {
  add,
  edit,
  indent,
  outdent,
  remove,
  removeProperty,
  renameProperty,
  setProperty,
} from './steps.ts';
import type { Step } from './steps.ts';
import type { Command } from '../../../../shared/pages.ts';

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
async function run(pages: ReturnType<typeof bridge>, step: Step | undefined) {
  assert.ok(step);
  const [event, send] = step;
  await send();
  return { event, calls: pages.calls };
}

test('each step draws the event main writes, and sends the write that records it', async () => {
  const pages = bridge();
  const cases: [Step | undefined, unknown, Command][] = [
    [add(pages, 'n', 'Mira', 'hi', 'a'), blockCreated('Mira', 'hi', 'a', 'n'), { type: 'addBlock', id: 'n', title: 'Mira', text: 'hi', after: 'a' }],
    [add(pages, 'n', 'Mira', 'hi'), blockCreated('Mira', 'hi', undefined, 'n'), { type: 'addBlock', id: 'n', title: 'Mira', text: 'hi' }],
    [edit(pages, 'a', 'A!'), blockEdited('a', 'A!'), { type: 'editBlock', blockId: 'a', text: 'A!' }],
    [remove(pages, 'a'), blockDeleted('a'), { type: 'deleteBlock', blockId: 'a' }],
    [indent(pages, blocks, 'b'), blockIndented({ id: 'b', parent: 'a' }), { type: 'indentBlock', blockId: 'b' }],
    [outdent(pages, blocks, 'c'), blockOutdented({ id: 'c', after: 'b' }), { type: 'outdentBlock', blockId: 'c' }],
    [setProperty(pages, 'Mira', 'Status', 'done'), propertySet('Mira', 'Status', 'done'), { type: 'setProperty', title: 'Mira', key: 'Status', value: 'done' }],
    [removeProperty(pages, 'Mira', 'Status'), propertyRemoved('Mira', 'Status'), { type: 'removeProperty', title: 'Mira', key: 'Status' }],
  ];
  for (const [step, built, call] of cases) {
    pages.calls.length = 0;
    const { event, calls } = await run(pages, step);
    assert.deepEqual(event, built);
    assert.deepEqual(calls, [call]);
  }
});

test('a move with nowhere to go is no step at all', () => {
  const pages = bridge();
  assert.equal(indent(pages, blocks, 'a'), undefined);
  assert.equal(indent(pages, blocks, 'c'), undefined);
  assert.equal(outdent(pages, blocks, 'a'), undefined);
  assert.equal(indent(pages, blocks, 'nope'), undefined);
});

test('a rename draws both its events and sends its one command once', async () => {
  const calls: Command[] = [];
  const pages = {
    run: async (command: Command) => {
      calls.push(command);
      return 7;
    },
  };
  const steps = renameProperty(pages, 'Mira', 'Owner', 'Author', 'Sal');
  assert.deepEqual(
    steps.map(([event]) => event),
    [propertySet('Mira', 'Author', 'Sal'), propertyRemoved('Mira', 'Owner')],
  );
  const answers = [];
  for (const [, send] of steps) answers.push(await send());
  assert.deepEqual(answers, [7, 7]);
  assert.deepEqual(calls, [{ type: 'renameProperty', title: 'Mira', from: 'Owner', to: 'Author' }]);
});
