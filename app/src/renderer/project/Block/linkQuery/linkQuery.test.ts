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

test('a [[ opens, and what follows it is the query', () => {
  assert.deepEqual(query('see [[|]]'), { at: 4, query: '', form: 'brackets' });
  assert.deepEqual(query('see [[Foo P|]]'), { at: 4, query: 'Foo P', form: 'brackets' });
  assert.deepEqual(query('#[[Foo|'), { at: 1, query: 'Foo', form: 'brackets' });
});

test('the target of an alias opens too', () => {
  assert.deepEqual(query('[some link]([[Fo|]]'), { at: 12, query: 'Fo', form: 'alias' });
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

test('a # that can start a tag opens, and what follows it is the query', () => {
  assert.deepEqual(query('#|'), { at: 0, query: '', form: 'tag' });
  assert.deepEqual(query('see #Fo|'), { at: 4, query: 'Fo', form: 'tag' });
  assert.deepEqual(query('(#work/pro|'), { at: 1, query: 'work/pro', form: 'tag' });
  assert.deepEqual(query('_#café|'), { at: 1, query: 'café', form: 'tag' });
  assert.deepEqual(query('#Fo|o'), { at: 0, query: 'Fo', form: 'tag' });
});

test('a # opens nowhere the parser would not read a tag', () => {
  assert.equal(query('a#b|'), null);
  assert.equal(query('##|'), null);
  assert.equal(query('##b|'), null);
  assert.equal(query('a.com/#top|'), null);
  assert.equal(query('`#foo|`'), null);
  assert.equal(query('```\n#foo|\n```'), null);
  assert.equal(query('$#x|$'), null);
});

test('a # closes on anything a bare tag cannot hold, or across a line', () => {
  assert.equal(query('# |'), null);
  assert.equal(query('#Foo |'), null);
  assert.equal(query('#Foo.|'), null);
  assert.equal(query('#Foo\n|'), null);
  assert.equal(query('#Foo bar|'), null);
});

test('#[[ is the [[ list, and a # inside an open [[ is part of its name', () => {
  assert.deepEqual(query('#[[|]]'), { at: 1, query: '', form: 'brackets' });
  assert.deepEqual(query('[[a #b|]]'), { at: 0, query: 'a #b', form: 'brackets' });
  assert.deepEqual(query('[[Foo]] #b|'), { at: 8, query: 'b', form: 'tag' });
});

test('picking a tag keeps it bare when it can be, brackets it when not', () => {
  assert.equal(pick('see #Fo| then', 'Foo'), 'see #Foo| then');
  assert.equal(pick('see #Fo|', 'Foo Page'), 'see #[[Foo Page]]|');
  assert.equal(pick('#|', 'work/2026'), '#work/2026|');
  assert.equal(pick('#|', 'Foo.'), '#[[Foo.]]|');
  assert.equal(pick('#Fo|o, then', 'Foo'), '#Foo|, then');
});
