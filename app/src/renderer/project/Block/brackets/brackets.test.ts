/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bracketEdit } from './brackets.ts';

/** Applies the edit and marks the selection with `|`, or `|…|` for a range. */
function type(key: string, marked: string): string | null {
  const start = marked.indexOf('|');
  const end = marked.lastIndexOf('|') - (start === marked.lastIndexOf('|') ? 0 : 1);
  const value = marked.replaceAll('|', '');
  const edit = bracketEdit(key, value, start, end);
  if (!edit) return null;
  const next = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
  const [a, b] = edit.select;
  return a === b
    ? next.slice(0, a) + '|' + next.slice(a)
    : next.slice(0, a) + '|' + next.slice(a, b) + '|' + next.slice(b);
}

test('[ inserts a pair with the caret inside', () => {
  assert.equal(type('[', 'a|b'), 'a[|]b');
  assert.equal(type('[', 'a[|]b'), 'a[[|]]b');
});

test('[ wraps a selection and keeps it selected', () => {
  assert.equal(type('[', 'a|Foo|b'), 'a[|Foo|]b');
  assert.equal(type('[', 'a[|Foo|]b'), 'a[[|Foo|]]b');
});

test('] steps over a ] already there, and types one otherwise', () => {
  assert.equal(type(']', '[[Foo|]]'), '[[Foo]|]');
  assert.equal(type(']', '[[Foo]|]'), '[[Foo]]|');
  assert.equal(type(']', 'Foo|'), null);
});

test('Backspace in an empty pair deletes both', () => {
  assert.equal(type('Backspace', 'a[|]b'), 'a|b');
  assert.equal(type('Backspace', '[Foo|]'), null);
  assert.equal(type('Backspace', '|'), null);
});

test('( pairs like [', () => {
  assert.equal(type('(', '[foo]|'), '[foo](|)');
  assert.equal(type('[', '[foo](|)'), '[foo]([|])');
  assert.equal(type('(', 'a|Foo|b'), 'a(|Foo|)b');
  assert.equal(type(')', '(Foo|)'), '(Foo)|');
  assert.equal(type(')', 'Foo|'), null);
  assert.equal(type('Backspace', 'a(|)b'), 'a|b');
  assert.equal(type('Backspace', '(|]'), null);
});

test('` pairs with itself', () => {
  assert.equal(type('`', 'a |b'), 'a `|`b');
  assert.equal(type('`', '`foo|`'), '`foo`|');
  assert.equal(type('`', 'a |Foo| b'), 'a `|Foo|` b');
  assert.equal(type('Backspace', 'a `|` b'), 'a | b');
});

test('` does not pair after a word, and a fence comes out clean', () => {
  assert.equal(type('`', 'foo|'), null);
  assert.equal(type('`', '|'), '`|`');
  assert.equal(type('`', '`|`'), '``|');
  assert.equal(type('`', '``|'), null);
});

test('$ pairs with itself, and an empty pair becomes display math', () => {
  assert.equal(type('$', 'a |b'), 'a $|$b');
  assert.equal(type('$', '$x^2|$'), '$x^2$|');
  assert.equal(type('$', '$|$'), '$$|$$');
  assert.equal(type('$', '$$x|$$'), '$$x$|$');
  assert.equal(type('$', 'a |x| b'), 'a $|x|$ b');
  assert.equal(type('Backspace', 'a $|$ b'), 'a | b');
  assert.equal(type('Backspace', 'a $$|$$ b'), 'a | b');
});

test('$ does not pair after a word, a backslash or another $', () => {
  assert.equal(type('$', 'US|'), null);
  assert.equal(type('$', '\\|'), null);
  assert.equal(type('$', '$x$|'), null);
});
