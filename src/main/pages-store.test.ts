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
  deleteBlock,
  editBlock,
  getPage,
  getPages,
  indentBlock,
  logDirectory,
  outdentBlock,
  reduce,
} from './pages-store.ts';
import type { ProjectRef } from './pages-store.ts';
import { logSize, segmentName } from './event-log.ts';
import { lastLeaf, locate } from '../shared/pages.ts';
import type { Block } from '../shared/pages.ts';

const TODAY = '2026-09-21';
const TOMORROW = '2026-09-22';

async function project(): Promise<ProjectRef> {
  return {
    id: randomUUID(),
    path: await mkdtemp(path.join(tmpdir(), 'gnotes-project-')),
  };
}

/**
 * The first segment of the only device writing in a project's log folder.
 *
 * The layout is `gnotes/<device>/<segment>`, and the device id is not fixed
 * here: these tests run with no binding, so each projection mints one. What
 * matters to a test is that exactly one machine wrote, which is asserted.
 */
async function segment(projectPath: string): Promise<string> {
  const directory = logDirectory(projectPath);
  const devices = await readdir(directory);
  assert.equal(devices.length, 1, 'one device should have written here');
  return path.join(directory, devices[0], segmentName(1));
}

test('the log is written into the project\'s own gnotes folder', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'lives here');

  assert.equal(logDirectory(it.path), path.join(it.path, 'gnotes'));
  // One directory per device, and the segments inside it. Nothing is written
  // at the top of `gnotes/`, so two machines never share a path.
  const [device] = await readdir(logDirectory(it.path));
  assert.deepEqual(await readdir(path.join(logDirectory(it.path), device)), [
    '0000000000000001.log',
  ]);
  assert.ok((await logSize(await segment(it.path))) > 0);

  await closePages();
});

test('opening a day that was never written to appends nothing', async () => {
  const it = await project();

  assert.deepEqual(await getPage(it, TODAY), { date: TODAY, blocks: [] });
  assert.equal(await logSize(await segment(it.path)), 0);

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

test('a deleted block stays gone across a restart', async () => {
  const it = await project();
  const created = await addBlock(it, TODAY, 'a mistake');
  await addBlock(it, TODAY, 'kept');
  const id = created.blocks[0].id;
  await addBlock(it, TODAY, 'also kept', id);

  const after = await deleteBlock(it, TODAY, id);
  assert.deepEqual(
    after.blocks.map((block) => block.text),
    ['also kept', 'kept'],
  );
  await closePages();

  // The delete is a fact appended after the create, so the replay has to reach
  // the same page — including the block written *beneath* the deleted one,
  // whose `after` now names an id the fold no longer holds. It was there when
  // the event was written, which is the only moment `after` is read.
  const replayed = await getPage(it, TODAY);
  assert.deepEqual(
    replayed.blocks.map((block) => block.text),
    ['also kept', 'kept'],
  );

  await closePages();
});

test('deleting a block the page does not have is refused', async () => {
  const it = await project();
  const created = await addBlock(it, TODAY, 'the only block');
  const id = created.blocks[0].id;

  await assert.rejects(
    () => deleteBlock(it, TODAY, 'not-a-real-id'),
    /No such block/,
  );
  // Gone once, gone for good: a second delete has nothing to append about.
  await deleteBlock(it, TODAY, id);
  await assert.rejects(() => deleteBlock(it, TODAY, id), /No such block/);

  await closePages();
});

test('the fold ignores events it does not know', async () => {
  const state = reduce({}, {
    seq: 1,
    device: 'd',
    hlc: { l: 1, c: 0 },
    id: 'x',
    type: 'something.else',
    v: 1,
    at: '2026-09-21T00:00:00.000Z',
    payload: {},
  });
  assert.deepEqual(state, {});
});

test('an indented block replays under the sibling above it', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'parent');
  const written = await addBlock(it, TODAY, 'child');
  const child = written.blocks[1].id;

  const indented = await indentBlock(it, TODAY, child);
  assert.deepEqual(
    indented.blocks.map((block) => block.text),
    ['parent'],
    'it is no longer a block of the page',
  );
  assert.deepEqual(
    indented.blocks[0].children.map((block) => block.text),
    ['child'],
  );

  // Nesting is not stored on the blocks any more than position is: the event
  // says which parent it moved under, and the fold has to put it back there.
  await closePages();
  const replayed = await getPage(it, TODAY);
  assert.deepEqual(
    replayed.blocks[0].children.map((block) => block.text),
    ['child'],
  );
  assert.equal(replayed.blocks[0].children[0].id, child);

  await closePages();
});

test('indenting carries the whole subtree, and stacks', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'first');
  const two = (await addBlock(it, TODAY, 'second')).blocks[1].id;
  const three = (await addBlock(it, TODAY, 'third')).blocks[2].id;

  // `third` goes under `second`, then `second` — carrying `third` — under
  // `first`. Two levels out of two keystrokes.
  await indentBlock(it, TODAY, three);
  const page = await indentBlock(it, TODAY, two);

  assert.equal(page.blocks.length, 1);
  assert.equal(page.blocks[0].text, 'first');
  assert.equal(page.blocks[0].children[0].text, 'second');
  assert.equal(page.blocks[0].children[0].children[0].text, 'third');

  await closePages();
  const replayed = await getPage(it, TODAY);
  assert.equal(replayed.blocks[0].children[0].children[0].text, 'third');

  await closePages();
});

test('indenting the first of its siblings appends nothing', async () => {
  const it = await project();
  const first = (await addBlock(it, TODAY, 'first')).blocks[0].id;
  await addBlock(it, TODAY, 'second');
  const before = await logSize(await segment(it.path));

  const page = await indentBlock(it, TODAY, first);
  assert.deepEqual(
    page.blocks.map((block) => block.text),
    ['first', 'second'],
  );
  assert.equal(
    await logSize(await segment(it.path)),
    before,
    'a keystroke that changed nothing is not a fact',
  );

  await assert.rejects(
    () => indentBlock(it, TODAY, 'not-a-real-id'),
    /No such block/,
  );

  await closePages();
});

test('a new block lands beside a nested one, not back at the top', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'parent');
  const child = (await addBlock(it, TODAY, 'child')).blocks[1].id;
  await indentBlock(it, TODAY, child);

  // `after` is the only thing placing this block, so if the fold only looked
  // at the top level it would land as a second block of the page.
  const page = await addBlock(it, TODAY, 'sibling', child);
  assert.equal(page.blocks.length, 1);
  assert.deepEqual(
    page.blocks[0].children.map((block) => block.text),
    ['child', 'sibling'],
  );

  await closePages();
});

test('deleting a block takes its children out of the fold with it', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'kept');
  const parent = (await addBlock(it, TODAY, 'parent')).blocks[1].id;
  const child = (await addBlock(it, TODAY, 'child')).blocks[2].id;
  await indentBlock(it, TODAY, child);

  const page = await deleteBlock(it, TODAY, parent);
  assert.deepEqual(
    page.blocks.map((block) => block.text),
    ['kept'],
  );

  // The child's own events are still on disk; the replay has to reach the
  // same page anyway, because the delete is a later fact than all of them.
  await closePages();
  assert.deepEqual(
    (await getPage(it, TODAY)).blocks.map((block) => block.text),
    ['kept'],
  );
  await assert.rejects(
    () => editBlock(it, TODAY, child, 'orphan'),
    /No such block/,
  );

  await closePages();
});

/**
 * The two helpers the caret rides on. They live in `shared` because main
 * needs them to resolve an indent and the renderer needs them to decide
 * where Backspace lands, and this is the only place either is exercised
 * without a browser.
 */
test('locate and lastLeaf read the page the way it renders', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'one');
  const two = (await addBlock(it, TODAY, 'two')).blocks[1].id;
  const three = (await addBlock(it, TODAY, 'three')).blocks[2].id;
  // Deepest first. Indent is always relative to the siblings a block has
  // *now*, so indenting `two` before `three` would leave `three` at the top
  // level with `one` above it, and file it there instead.
  await indentBlock(it, TODAY, three);
  await indentBlock(it, TODAY, two);
  // one
  //   two
  //     three
  const last = (await addBlock(it, TODAY, 'four')).blocks;

  assert.deepEqual(
    last.map((block) => block.text),
    ['one', 'four'],
  );

  const found = locate(last, three);
  assert.equal(found?.at, 0, 'three is the only child of two');
  assert.equal(found?.parent?.text, 'two');
  assert.equal(locate(last, 'not-a-real-id'), undefined);

  // What Backspace at the start of `four` has to find: not the sibling above
  // it, but the deepest thing filed under that sibling.
  assert.equal(lastLeaf(last[0]).text, 'three');
  assert.equal(lastLeaf(last[1]).text, 'four', 'a leaf is its own last leaf');

  await closePages();
});

/** The page top to bottom, depth first — the order it reads on screen. */
function reading(blocks: Block[]): string[] {
  return blocks.flatMap((block) => [block.text, ...reading(block.children)]);
}

test('outdenting lands a block beneath what it hung under', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'parent');
  const child = (await addBlock(it, TODAY, 'child')).blocks[1].id;
  await addBlock(it, TODAY, 'after the lot');
  await indentBlock(it, TODAY, child);

  const page = await outdentBlock(it, TODAY, child);
  assert.deepEqual(
    page.blocks.map((block) => block.text),
    ['parent', 'child', 'after the lot'],
    'directly beneath its old parent, not at the end of the page',
  );
  assert.deepEqual(page.blocks[0].children, []);

  await closePages();
  assert.deepEqual(reading((await getPage(it, TODAY)).blocks), [
    'parent',
    'child',
    'after the lot',
  ]);

  await closePages();
});

test('outdenting brings the siblings below it along as children', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'P');
  const a = (await addBlock(it, TODAY, 'A')).blocks[1].id;
  const b = (await addBlock(it, TODAY, 'B')).blocks[2].id;
  const c = (await addBlock(it, TODAY, 'C')).blocks[3].id;
  // Forward, one at a time. Each is a root block sitting directly under `P`
  // when its turn comes, so each lands as another of P's children. Going
  // backwards would build a ladder instead — P > A > B > C — because by then
  // the sibling above is the one just indented.
  for (const id of [a, b, c]) await indentBlock(it, TODAY, id);
  // P > A, B, C — all three filed under P.
  const before = await getPage(it, TODAY);
  assert.deepEqual(reading(before.blocks), ['P', 'A', 'B', 'C']);

  // Outdent the middle one. C cannot stay under P: P renders above B, so C
  // would come back reading *before* B off a keystroke about depth alone.
  const page = await outdentBlock(it, TODAY, b);
  assert.deepEqual(reading(page.blocks), ['P', 'A', 'B', 'C']);
  assert.deepEqual(
    page.blocks.map((block) => block.text),
    ['P', 'B'],
  );
  assert.deepEqual(
    page.blocks[0].children.map((block) => block.text),
    ['A'],
  );
  assert.deepEqual(
    page.blocks[1].children.map((block) => block.text),
    ['C'],
  );

  await closePages();
  assert.deepEqual(reading((await getPage(it, TODAY)).blocks), [
    'P',
    'A',
    'B',
    'C',
  ]);

  await closePages();
});

test('indent then outdent puts the page back as it was', async () => {
  const it = await project();
  await addBlock(it, TODAY, 'one');
  const two = (await addBlock(it, TODAY, 'two')).blocks[1].id;
  await addBlock(it, TODAY, 'three');

  await indentBlock(it, TODAY, two);
  const back = await outdentBlock(it, TODAY, two);
  assert.deepEqual(
    back.blocks.map((block) => block.text),
    ['one', 'two', 'three'],
  );

  // Four facts on disk, none of them rewritten, folding to the page the user
  // started with.
  await closePages();
  assert.deepEqual(reading((await getPage(it, TODAY)).blocks), [
    'one',
    'two',
    'three',
  ]);

  await closePages();
});

test('outdenting a top-level block appends nothing', async () => {
  const it = await project();
  const first = (await addBlock(it, TODAY, 'top level')).blocks[0].id;
  const before = await logSize(await segment(it.path));

  const page = await outdentBlock(it, TODAY, first);
  assert.deepEqual(
    page.blocks.map((block) => block.text),
    ['top level'],
  );
  assert.equal(
    await logSize(await segment(it.path)),
    before,
    'a keystroke that changed nothing is not a fact',
  );

  await assert.rejects(
    () => outdentBlock(it, TODAY, 'not-a-real-id'),
    /No such block/,
  );

  await closePages();
});

test('every written day comes back newest first, emptied days left out', async () => {
  const it = await project();
  await addBlock(it, '2026-09-20', 'the oldest thing');
  await addBlock(it, TOMORROW, 'the newest thing');
  const gone = await addBlock(it, TODAY, 'written then deleted');
  await deleteBlock(it, TODAY, gone.blocks[0].id);

  assert.deepEqual(
    (await getPages(it)).map((page) => page.date),
    [TOMORROW, '2026-09-20'],
    'newest first, and a day that folds to nothing is not a page',
  );
  // Today is not invented here either: which day that is belongs to the
  // renderer, which puts it at the top of the stack itself.
  assert.deepEqual((await getPages(it))[0].blocks[0].text, 'the newest thing');

  await closePages();
});
