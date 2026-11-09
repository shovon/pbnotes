/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParsed } from './parsed.ts';

/** A render that counts how often it is asked. */
const counting = () => {
  const asked: string[] = [];
  return { asked, render: (text: string) => (asked.push(text), { text }) };
};

test('a text is rendered once, and the same answer handed back after', () => {
  const { asked, render } = counting();
  const parsed = createParsed(render, 10);
  const first = parsed('a');
  assert.equal(parsed('a'), first);
  assert.deepEqual(asked, ['a']);
});

test('another text is rendered on its own', () => {
  const { asked, render } = counting();
  const parsed = createParsed(render, 10);
  parsed('a');
  parsed('b');
  assert.deepEqual(asked, ['a', 'b']);
});

test('past the limit, the text used longest ago goes first', () => {
  const { asked, render } = counting();
  const parsed = createParsed(render, 2);
  parsed('a');
  parsed('b');
  parsed('a'); // used again: b is now the oldest
  parsed('c'); // b goes
  parsed('a');
  parsed('b');
  assert.deepEqual(asked, ['a', 'b', 'c', 'b']);
});

test('an answer that is undefined or null is kept too', () => {
  let n = 0;
  const parsed = createParsed((): null => (n++, null), 10);
  parsed('x');
  parsed('x');
  assert.equal(n, 1);
});
