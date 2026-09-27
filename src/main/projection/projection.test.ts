/**
 * Run with: npm test
 *
 * The property that matters is that a view rebuilt from the log is identical
 * to the view maintained live. Everything else here is a getter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp } from 'node:fs/promises';
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

/**
 * One machine, across every session in this file.
 *
 * Pinned rather than left to default because `seq` counts within a device now,
 * and a fresh id per session would mean a fresh directory per session — which
 * is what a real machine avoids by keeping its id in `notes.db`.
 */
const DEVICE = 'device-under-test';

/** A fresh log directory; the projection owns everything inside it. */
async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'gnotes-proj-'));
}

async function writeSession(directory: string): Promise<Notes> {
  const live = await Projection.open<Notes>(directory, reduce, {}, { device: DEVICE });
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
  const reopened = await Projection.open<Notes>(file, reduce, {}, { device: DEVICE });
  assert.deepEqual(reopened.state, live);
  assert.deepEqual(reopened.state, { a: 'morning, revised', c: 'evening' });
  assert.equal(reopened.seq, 5);
  await reopened.close();
});

test('a second session appends to the first', async () => {
  const file = await scratch();
  await writeSession(file);

  const day2 = await Projection.open<Notes>(file, reduce, {}, { device: DEVICE });
  await day2.dispatch('note.written', { id: 'd', text: 'next day' });
  assert.equal(day2.seq, 6);
  await day2.close();

  const day3 = await Projection.open<Notes>(file, reduce, {}, { device: DEVICE });
  assert.deepEqual(day3.state, {
    a: 'morning, revised',
    c: 'evening',
    d: 'next day',
  });
  await day3.close();
});

test('subscribers see each folded state', async () => {
  const file = await scratch();
  const projection = await Projection.open<Notes>(file, reduce, {}, { device: DEVICE });

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
  const projection = await Projection.open<Notes>(file, reduce, {}, { device: DEVICE });
  await projection.dispatch('note.written', { id: 'a', text: 'durable' });

  const before = projection.state;
  await projection.close(); // the handle is gone; the next write cannot land

  await assert.rejects(() =>
    projection.dispatch('note.written', { id: 'b', text: 'lost' }),
  );
  assert.equal(projection.state, before, 'state must not move on a failed write');
  assert.deepEqual(projection.state, { a: 'durable' });
});

// ---------------------------------------------------------------------------
// A folder several machines write into.
// ---------------------------------------------------------------------------

/** One machine's log, written somewhere of its own so it can be delivered. */
async function deviceLog(device: string, notes: string[]): Promise<string> {
  const home = await scratch();
  const log = await Projection.open<Notes>(home, reduce, {}, { device });
  for (const [i, text] of notes.entries()) {
    await log.dispatch('note.written', { id: `${device}-${i}`, text });
  }
  await log.close();
  return path.join(home, device);
}

test('every device folds to the same view, whatever order things arrive in', async () => {
  const written = await Promise.all([
    deviceLog('device-a', ['one', 'two']),
    deviceLog('device-b', ['three']),
    deviceLog('device-c', ['four', 'five', 'six']),
  ]);

  // Arrival order is the only thing a sync tool really varies, and it is a
  // parameter — no second machine and no Dropbox required.
  const orders = [
    [0, 1, 2],
    [2, 1, 0],
    [1, 2, 0],
    [0, 2, 1],
  ];

  let expected: Notes | undefined;
  for (const order of orders) {
    const folder = await scratch();
    const view = await Projection.open<Notes>(folder, reduce, {}, {
      device: 'reader',
    });
    for (const which of order) {
      await cp(written[which], path.join(folder, path.basename(written[which])), {
        recursive: true,
      });
      // Re-folded at every step, exactly as the watcher would.
      await view.refold();
    }
    expected ??= view.state;
    assert.deepEqual(
      view.state,
      expected,
      `converged differently for arrival order ${order.join('')}`,
    );
    await view.close();
  }

  assert.deepEqual(Object.keys(expected as Notes).sort(), [
    'device-a-0',
    'device-a-1',
    'device-b-0',
    'device-c-0',
    'device-c-1',
    'device-c-2',
  ]);
});

test('a device that appears after opening is folded in', async () => {
  const folder = await scratch();
  const view = await Projection.open<Notes>(folder, reduce, {}, {
    device: 'reader',
  });
  await view.dispatch('note.written', { id: 'mine', text: 'here first' });

  const arriving = await deviceLog('device-b', ['from elsewhere']);
  await cp(arriving, path.join(folder, 'device-b'), { recursive: true });
  assert.deepEqual(view.state, { mine: 'here first' }, 'not until it re-folds');

  await view.refold();
  assert.deepEqual(view.state, {
    mine: 'here first',
    'device-b-0': 'from elsewhere',
  });
  await view.close();
});

test('events this build cannot fold are counted, not silently dropped', async () => {
  const folder = await scratch();
  const newer = await Projection.open<Notes>(folder, reduce, {}, {
    device: 'device-newer',
  });
  await newer.dispatch('note.written', { id: 'a', text: 'understood' });
  await newer.dispatch('note.scribbled', { id: 'b' });
  await newer.dispatch('note.scribbled', { id: 'c' });
  // A payload shape this build predates.
  await newer.dispatch('note.written', { id: 'd', text: 'v2' }, 2);
  await newer.close();

  const older = await Projection.open<Notes>(folder, reduce, {}, {
    device: 'device-older',
    handles: { 'note.written': 1, 'note.deleted': 1 },
  });

  assert.deepEqual(older.status.unhandled, [
    { type: 'note.scribbled', v: 1, count: 2 },
    { type: 'note.written', v: 2, count: 1 },
  ]);
  // Skipping stays the behaviour: one unknown event type on one machine must
  // not lock the user out of their notes everywhere.
  assert.equal(older.state.a, 'understood');
  await older.close();
});

/**
 * Appends, the way the real page reducer does: a block's place on the page
 * comes from the fold, so an event folded twice is a block on the page twice.
 * `reduce` above is keyed by id and so is idempotent — it would fold the same
 * log ten times and look right, which is exactly why it cannot test this.
 */
const appendReduce: Reducer<string[]> = (state, event) =>
  event.type === 'note.written'
    ? [...state, (event.payload as { id: string }).id]
    : state;

test('re-folding a log that was not empty at open does not double it', async () => {
  const file = await scratch();
  await writeSession(file);

  // The case the watcher hits all day and no test above reaches: every
  // earlier refold test opens on an empty folder, where "the state at open"
  // and "the state the fold started from" happen to be the same thing.
  const reopened = await Projection.open<string[]>(file, appendReduce, [], {
    device: DEVICE,
  });
  assert.deepEqual(reopened.state, ['a', 'b', 'a', 'c']);

  await reopened.refold();
  assert.deepEqual(
    reopened.state,
    ['a', 'b', 'a', 'c'],
    'a refold rebuilds the view; it must not fold the log onto itself',
  );
  await reopened.close();
});
