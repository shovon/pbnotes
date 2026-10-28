/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockOutdented,
} from '@pbnotes/pages';
import type { Block } from '@pbnotes/pages';
import { add, edit, indent, outdent, remove } from './steps.ts';
import type { Step } from './steps.ts';

/** The calls a step made, by name and arguments, in place of main. */
function bridge() {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]): Promise<void> => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    addBlock: record('addBlock'),
    editBlock: record('editBlock'),
    deleteBlock: record('deleteBlock'),
    indentBlock: record('indentBlock'),
    outdentBlock: record('outdentBlock'),
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
  const cases: [Step | undefined, unknown, unknown[]][] = [
    [add(pages, 'n', 'Mira', 'hi', 'a'), blockCreated('Mira', 'hi', 'a', 'n'), ['addBlock', 'n', 'Mira', 'hi', 'a']],
    [add(pages, 'n', 'Mira', 'hi'), blockCreated('Mira', 'hi', undefined, 'n'), ['addBlock', 'n', 'Mira', 'hi', undefined]],
    [edit(pages, 'a', 'A!'), blockEdited('a', 'A!'), ['editBlock', 'a', 'A!']],
    [remove(pages, 'a'), blockDeleted('a'), ['deleteBlock', 'a']],
    [indent(pages, blocks, 'b'), blockIndented({ id: 'b', parent: 'a' }), ['indentBlock', 'b']],
    [outdent(pages, blocks, 'c'), blockOutdented({ id: 'c', after: 'b' }), ['outdentBlock', 'c']],
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
