/**
 * Run with: npm test
 *
 * The one property this file adds to what `pages-store.test.ts` already
 * covers through it: two folds on one project are one log and one writer, and
 * neither mistakes the other's events for something it cannot read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  closeLedgers,
  defineFold,
  deviceOf,
  logDirectory,
} from './project-ledger.ts';
import type { Fold } from './project-ledger.ts';

/** Collects the payloads of one event type, in order. */
function collect<T extends string>(type: T): Fold<string[], T> {
  return {
    reduce: (state, event) =>
      event.type === type ? [...state, event.payload as string] : state,
    initial: [],
    handles: { [type]: 1 } as Record<T, number>,
  };
}

const notes = defineFold('notes', collect('note.written'));
const chat = defineFold('chat', collect('message.sent'));

test('two folds share one log, one writer, and one status', async () => {
  const project = {
    id: randomUUID(),
    path: await mkdtemp(path.join(tmpdir(), 'pbnotes-ledger-')),
  };

  const written = await notes(project);
  const said = await chat(project);
  await written.dispatch('note.written', 'a');
  await said.dispatch('message.sent', 'hello');
  await written.dispatch('note.written', 'b');

  assert.deepEqual(written.state, ['a', 'b']);
  assert.deepEqual(said.state, ['hello']);
  assert.deepEqual(written.status.unhandled, []);
  assert.deepEqual(await readdir(logDirectory(project.path)), [
    await deviceOf(project),
  ]);

  await closeLedgers();
  assert.deepEqual((await chat(project)).state, ['hello']);
  assert.deepEqual((await notes(project)).state, ['a', 'b']);
  await closeLedgers();
});

test('a fold cannot join once a ledger is open', async () => {
  const project = {
    id: randomUUID(),
    path: await mkdtemp(path.join(tmpdir(), 'pbnotes-ledger-')),
  };
  await notes(project);
  assert.throws(() => defineFold('late', collect('late.event')), /after/);
  await closeLedgers();
});
