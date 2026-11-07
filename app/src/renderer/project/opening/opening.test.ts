/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAIN, shown, whereFrom } from './opening.ts';

test('with no keys held a page opens here', () => {
  assert.equal(whereFrom(PLAIN, true), 'here');
  assert.equal(whereFrom(PLAIN, false), 'here');
});

test('Shift opens it beside, in the right sidebar', () => {
  assert.equal(whereFrom({ ...PLAIN, shiftKey: true }, true), 'beside');
  assert.equal(whereFrom({ ...PLAIN, shiftKey: true }, false), 'beside');
});

test('the platform modifier opens it in a new tab behind: Cmd on macOS, Ctrl elsewhere', () => {
  assert.equal(whereFrom({ ...PLAIN, metaKey: true }, true), 'background');
  assert.equal(whereFrom({ ...PLAIN, ctrlKey: true }, false), 'background');
});

test('the modifier with Shift opens a new tab, shown at once', () => {
  assert.equal(whereFrom({ ...PLAIN, metaKey: true, shiftKey: true }, true), 'tab');
  assert.equal(whereFrom({ ...PLAIN, ctrlKey: true, shiftKey: true }, false), 'tab');
});

test("the other platform's modifier is not it", () => {
  assert.equal(whereFrom({ ...PLAIN, ctrlKey: true }, true), 'here');
  assert.equal(whereFrom({ ...PLAIN, metaKey: true }, false), 'here');
});

test('where picking is going somewhere, a new tab is shown, and the rest is as it was', () => {
  assert.equal(shown('background'), 'tab');
  assert.equal(shown('tab'), 'tab');
  assert.equal(shown('beside'), 'beside');
  assert.equal(shown('here'), 'here');
});
