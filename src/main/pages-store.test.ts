/**
 * Run with: npm test
 *
 * Three properties. The log lives in the project's own directory. Looking at a
 * day appends nothing — a page the user only opened must not become a fact in
 * a log that keeps facts forever. And because the log travels with the folder,
 * a project that moved reads its blocks back from its new home.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  addBlock,
  closePages,
  editBlock,
  getPage,
  logDirectory,
  reduce,
} from './pages-store.ts';
import type { ProjectRef } from './pages-store.ts';
import { logSize } from './event-log.ts';

const TODAY = '2026-09-21';
const TOMORROW = '2026-09-22';

async function project(): Promise<ProjectRef> {
  return {
    id: randomUUID(),
    path: await mkdtemp(path.join(tmpdir(), 'gnotes-project-')),
  };
}

test('the log is written into the project\'s own gnotes folder', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'lives here');

  assert.equal(logDirectory(it.path), path.join(it.path, 'gnotes'));
  assert.deepEqual(await readdir(logDirectory(it.path)), [
    '0000000000000001.log',
  ]);
  assert.ok(
    (await logSize(path.join(logDirectory(it.path), '0000000000000001.log'))) >
      0,
  );

  await closePages();
});

test('opening a day that was never written to appends nothing', async () => {
  const it = await project();

  assert.deepEqual(await getPage(it, TODAY), { date: TODAY, blocks: [] });
  assert.equal(
    await logSize(path.join(logDirectory(it.path), '0000000000000001.log')),
    0,
  );

  await closePages();
});

test('blocks survive a restart, in order, per project and per day', async () => {
  const one = await project();
  const two = await project();
  const written = await addBlock(one, TODAY, 'first');
  await addBlock(one, TODAY, 'second');
  await addBlock(one, TOMORROW, 'next day');
  await addBlock(two, TODAY, 'other project');
  await closePages();

  // Shut down for the day, start up the next morning.
  const page = await getPage(one, TODAY);
  assert.deepEqual(
    page.blocks.map((block) => block.text),
    ['first', 'second'],
  );
  assert.equal(page.blocks[0].id, written.blocks[0].id);
  assert.deepEqual(
    (await getPage(one, TOMORROW)).blocks.map((block) => block.text),
    ['next day'],
  );
  assert.deepEqual(
    (await getPage(two, TODAY)).blocks.map((block) => block.text),
    ['other project'],
  );

  await closePages();
});

test('a block written after another replays in that position', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'first');
  await addBlock(it, TODAY, 'last');
  const first = (await getPage(it, TODAY)).blocks[0].id;
  const written = await addBlock(it, TODAY, 'wedged', first);

  assert.deepEqual(
    written.blocks.map((block) => block.text),
    ['first', 'wedged', 'last'],
  );

  // The position is not stored on the blocks, so it only holds if the fold
  // puts it back — which is the whole claim being made here.
  await closePages();
  assert.deepEqual(
    (await getPage(it, TODAY)).blocks.map((block) => block.text),
    ['first', 'wedged', 'last'],
  );

  await closePages();
});

test('adding after a block the page does not have is refused', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'first');
  await assert.rejects(
    () => addBlock(it, TODAY, 'orphan', 'no-such-block'),
    /No such block/,
  );
  assert.deepEqual(
    (await getPage(it, TODAY)).blocks.map((block) => block.text),
    ['first'],
  );

  await closePages();
});

test('a project that moved reads its log from the new directory', async () => {
  const before = await project();
  await addBlock(before, TODAY, 'written before the move');

  // Relocated while the projection for the old path is still open and cached.
  const after = { id: before.id, path: `${before.path}-moved` };
  await rename(before.path, after.path);

  assert.deepEqual(
    (await getPage(after, TODAY)).blocks.map((block) => block.text),
    ['written before the move'],
  );

  await closePages();
});

test('an edited block replays as its latest text', async () => {
  const it = await project();
  const created = await addBlock(it, TODAY, 'first draft');
  await addBlock(it, TODAY, 'untouched');
  const id = created.blocks[0].id;

  const edited = await editBlock(it, TODAY, id, 'second draft');
  assert.deepEqual(
    edited.blocks.map((block) => block.text),
    ['second draft', 'untouched'],
  );
  await closePages();

  // The edit is a second fact appended after the first, so replaying both in
  // order has to land on the later one — and leave the block where it was.
  const replayed = await getPage(it, TODAY);
  assert.deepEqual(
    replayed.blocks.map((block) => block.text),
    ['second draft', 'untouched'],
  );
  assert.equal(replayed.blocks[0].id, id, 'editing does not re-identify it');

  await closePages();
});

test('editing a block the page does not have is refused', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'the only block');

  await assert.rejects(
    () => editBlock(it, TODAY, 'not-a-real-id', 'nope'),
    /No such block/,
  );
  await assert.rejects(
    () => editBlock(it, TOMORROW, 'not-a-real-id', 'nope'),
    /No such block/,
  );

  await closePages();
});

test('the fold ignores events it does not know', async () => {
  const state = reduce({}, {
    seq: 1,
    id: 'x',
    type: 'something.else',
    v: 1,
    at: '2026-09-21T00:00:00.000Z',
    payload: {},
  });
  assert.deepEqual(state, {});
});
