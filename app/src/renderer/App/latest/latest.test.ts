/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latest } from './latest.ts';

const at = (id: string, lastOpenedAt: string | null) => ({ id, lastOpenedAt });

test('the one opened most recently, wherever it is listed', () => {
  const projects = [
    at('a', '2026-11-01T00:00:00.000Z'),
    at('b', '2026-11-13T00:00:00.000Z'),
    at('c', null),
    at('d', '2026-11-12T00:00:00.000Z'),
  ];
  assert.equal(latest(projects)?.id, 'b');
});

test('none when nothing was ever opened, or nothing is tracked', () => {
  assert.equal(latest([at('a', null), at('b', null)]), undefined);
  assert.equal(latest([]), undefined);
});
