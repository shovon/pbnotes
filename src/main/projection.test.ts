/**
 * Run with: npm test
 *
 * The property that matters is that a view rebuilt from the log is identical
 * to the view maintained live. Everything else here is a getter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Projection } from './projection.ts';
import type { Reducer } from './projection.ts';

type Notes = Record<string, string>;

/** A stand-in for real content: writes land, deletes remove, order matters. */
const reduce: Reducer<Notes> = (state, event) => {
  const payload = event.payload as { id: string; text?: string };
  if (event.type === 'note.written') {
    return { ...state, [payload.id]: payload.text ?? '' };
  }
  if (event.type === 'note.deleted') {
    const next = { ...state };
    delete next[payload.id];
    return next;
  }
  return state;
};

/** A fresh log directory; the projection owns everything inside it. */
async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'gnotes-proj-'));
}

async function writeSession(directory: string): Promise<Notes> {
  const live = await Projection.open<Notes>(directory, reduce, {});
  await live.dispatch('note.written', { id: 'a', text: 'morning' });
  await live.dispatch('note.written', { id: 'b', text: 'afternoon' });
  await live.dispatch('note.written', { id: 'a', text: 'morning, revised' });
  await live.dispatch('note.deleted', { id: 'b' });
  await live.dispatch('note.written', { id: 'c', text: 'evening' });
  const state = live.state;
  await live.close();
  return state;
}

test('the rebuilt view equals the live view', async () => {
  const file = await scratch();
  const live = await writeSession(file);

  // Shut down for the day, start up the next morning.
  const reopened = await Projection.open<Notes>(file, reduce, {});
  assert.deepEqual(reopened.state, live);
  assert.deepEqual(reopened.state, { a: 'morning, revised', c: 'evening' });
  assert.equal(reopened.seq, 5);
  await reopened.close();
});

test('a second session appends to the first', async () => {
  const file = await scratch();
  await writeSession(file);

  const day2 = await Projection.open<Notes>(file, reduce, {});
  await day2.dispatch('note.written', { id: 'd', text: 'next day' });
  assert.equal(day2.seq, 6);
  await day2.close();

  const day3 = await Projection.open<Notes>(file, reduce, {});
  assert.deepEqual(day3.state, {
    a: 'morning, revised',
    c: 'evening',
    d: 'next day',
  });
  await day3.close();
});

test('subscribers see each folded state', async () => {
  const file = await scratch();
  const projection = await Projection.open<Notes>(file, reduce, {});

  const seen: Notes[] = [];
  const unsubscribe = projection.subscribe((state) => seen.push(state));
  await projection.dispatch('note.written', { id: 'a', text: 'one' });
  await projection.dispatch('note.written', { id: 'b', text: 'two' });
  unsubscribe();
  await projection.dispatch('note.written', { id: 'c', text: 'three' });

  assert.deepEqual(seen, [{ a: 'one' }, { a: 'one', b: 'two' }]);
  await projection.close();
});

test('a rejected append leaves the view untouched', async () => {
  const file = await scratch();
  const projection = await Projection.open<Notes>(file, reduce, {});
  await projection.dispatch('note.written', { id: 'a', text: 'durable' });

  const before = projection.state;
  await projection.close(); // the handle is gone; the next write cannot land

  await assert.rejects(() =>
    projection.dispatch('note.written', { id: 'b', text: 'lost' }),
  );
  assert.equal(projection.state, before, 'state must not move on a failed write');
  assert.deepEqual(projection.state, { a: 'durable' });
});
