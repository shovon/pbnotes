/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landing, STOPPED } from './landing.ts';

test('a step taken back goes to its page and highlights its block', () => {
  assert.deepEqual(landing({ version: 7, result: 'done', page: 'Foo', block: 'b1' }), {
    version: 7,
    page: 'Foo',
    block: 'b1',
  });
});

test('a step about a page as a whole goes to the page alone', () => {
  assert.deepEqual(landing({ version: 7, result: 'done', page: 'Foo' }), { version: 7, page: 'Foo' });
});

test('undo that stopped goes there too, and says why, by its reason', () => {
  assert.deepEqual(landing({ version: 3, result: 'changed', page: 'Foo', block: 'b1' }), {
    version: 3,
    page: 'Foo',
    block: 'b1',
    say: STOPPED.changed,
  });
  assert.equal(landing({ version: 3, result: 'cannot', page: 'Foo' }).say, STOPPED.cannot);
  assert.notEqual(STOPPED.changed, STOPPED.cannot);
});

test('nothing to do does nothing, and says nothing', () => {
  assert.deepEqual(landing({ version: 3, result: 'nothing' }), { version: 3 });
});
