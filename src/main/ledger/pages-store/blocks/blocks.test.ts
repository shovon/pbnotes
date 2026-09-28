/**
 * Run with: npm test
 *
 * The fold on its own: one event in, the whole view out, with no log, no
 * device and no project directory anywhere near it. That this file needs none
 * of those is the point of `blocks.ts` being separate from the store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from './blocks.ts';
import type { LogEvent } from '../../event-log/event-log.ts';

const TODAY = '2026-09-21';

/** One event, straight into `reduce`, with no log or device around it. */
function event(type: string, v: number, payload: unknown): LogEvent {
  return {
    seq: 1,
    device: 'd',
    hlc: { l: 1, c: 0 },
    id: 'x',
    type,
    v,
    at: '2026-09-21T00:00:00.000Z',
    payload,
  } as LogEvent;
}

test('the fold ignores events it does not know', async () => {
  assert.deepEqual(reduce({}, event('something.else', 1, {})), {});
});

/**
 * The shape every log already on disk was written in: a page on the events
 * that follow a creation. Nothing reads it any more, so there is no upcast to
 * exercise — what has to hold is that the id alone still reaches the block,
 * which is the whole claim that made dropping the field safe. No write path
 * produces these any more, so this is the only thing that would notice if
 * `reduce` ever went back to looking a page up.
 */
test('a v1 payload still folds, page and all', async () => {
  const created = reduce(
    {},
    event('block.created', 1, { page: TODAY, id: 'b1', text: 'first' }),
  );
  const nested = reduce(
    reduce(
      created,
      event('block.created', 1, { page: TODAY, id: 'b2', text: 'second' }),
    ),
    event('block.indented', 1, { page: TODAY, id: 'b2', parent: 'b1' }),
  );
  const edited = reduce(
    nested,
    event('block.edited', 1, { page: TODAY, id: 'b2', text: 'rewritten' }),
  );
  assert.deepEqual(edited[TODAY], [
    {
      id: 'b1',
      text: 'first',
      children: [{ id: 'b2', text: 'rewritten', children: [] }],
    },
  ]);

  // And the page on the event is not what found the block: a wrong one folds
  // the same way, where before it would have folded to nothing.
  const elsewhere = reduce(
    edited,
    event('block.edited', 1, { page: 'Mira', id: 'b2', text: 'again' }),
  );
  assert.equal(elsewhere[TODAY][0].children[0].text, 'again');
  assert.deepEqual(Object.keys(elsewhere), [TODAY]);
});
