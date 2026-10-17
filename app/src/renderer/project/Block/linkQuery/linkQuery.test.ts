/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeLink, linkQuery } from './linkQuery.ts';

/** The query at `|`, or null. */
function query(marked: string) {
  return linkQuery(marked.replace('|', ''), marked.indexOf('|'));
}

/** Picks `title` at `|` and marks where the caret lands. */
function pick(marked: string, title: string): string {
  const value = marked.replace('|', '');
  const caret = marked.indexOf('|');
  const found = linkQuery(value, caret);
  assert.ok(found, marked);
  const edit = completeLink(value, caret, found, title);
  const next = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
  return next.slice(0, edit.select[0]) + '|' + next.slice(edit.select[0]);
}

test('a bare [[ opens, and what follows it is the query', () => {
  assert.deepEqual(query('see [[|]]'), { at: 4, query: '', alias: false });
  assert.deepEqual(query('see [[Foo P|]]'), { at: 4, query: 'Foo P', alias: false });
  assert.deepEqual(query('#[[Foo|'), { at: 1, query: 'Foo', alias: false });
});

test('the target of an alias opens too', () => {
  assert.deepEqual(query('[some link]([[Fo|]]'), { at: 12, query: 'Fo', alias: true });
});

test('nothing opens in code, after the link is closed, or across a line', () => {
  assert.equal(query('`[[|`'), null);
  assert.equal(query('~~~\n[[|'), null);
  assert.equal(query('```\n[[|\n```'), null);
  assert.equal(query('[[Foo]]|'), null);
  assert.equal(query('[[Foo]] and |'), null);
  assert.equal(query('[[Foo\n|'), null);
  assert.equal(query('plain |'), null);
});

test('picking closes the link, using the brackets already there', () => {
  assert.equal(pick('see [[Fo|]] then', 'Foo Page'), 'see [[Foo Page]]| then');
  assert.equal(pick('see [[Fo|', 'Foo Page'), 'see [[Foo Page]]|');
  assert.equal(pick('[x]([[Fo|]]', 'Foo Page'), '[x]([[Foo Page]])|');
  assert.equal(pick('[x]([[Fo|]])', 'Foo Page'), '[x]([[Foo Page]])|');
});
