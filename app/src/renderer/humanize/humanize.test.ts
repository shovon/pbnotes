/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanize } from './humanize.ts';

test("Electron's IPC prefix and the error's class come off, the sentence stays", () => {
  const wrapped = new Error("Error invoking remote method 'graph:command': Error: “Notes” already has content.");
  assert.equal(humanize(wrapped), '“Notes” already has content.');
  const typed = new Error("Error invoking remote method 'graph:command': TypeError: Expected a page title");
  assert.equal(humanize(typed), 'Expected a page title');
});

test('a message with no prefix, or a thrown string, is left as it is', () => {
  assert.equal(humanize(new Error('Nothing to rename.')), 'Nothing to rename.');
  assert.equal(humanize('plain'), 'plain');
});
