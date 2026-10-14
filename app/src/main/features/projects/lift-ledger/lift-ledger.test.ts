/**
 * Run with: npm test
 *
 * The move is renames only, `LEDGER` last, nothing overwritten. So a folder
 * reads the same after it, a move stopped anywhere is finished by the next,
 * and a refusal leaves the folder as it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeLedgers, createLedger, defineFold, MARKER } from '@pbnotes/ledger';
import type { Fold } from '@pbnotes/ledger';
import { liftLedger, OLD_FOLDER } from './lift-ledger.ts';

const notes: Fold<string[], 'note'> = {
  reduce: (state, event) =>
    event.type === 'note' ? [...state, event.payload as string] : state,
  initial: [],
  handles: { note: 1 },
};
const notesOf = defineFold('notes', notes);

/** A project as it was before #42: its ledger in `gnotes/`, holding `devices`. */
async function oldProject(devices = ['a', 'b']): Promise<string> {
  const project = await mkdtemp(path.join(tmpdir(), 'pbnotes-lift-'));
  const from = path.join(project, OLD_FOLDER);
  await createLedger(from);
  for (const device of devices) {
    await mkdir(path.join(from, device));
    await writeFile(path.join(from, device, '0000000000000001.log'), '');
  }
  return project;
}

const sorted = async (directory: string) => (await readdir(directory)).sort();
const nothing = () => undefined;

test('a ledger written in gnotes/ reads the same from the project folder', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'pbnotes-lift-'));
  const from = path.join(project, OLD_FOLDER);
  await createLedger(from);
  const before = await notesOf({ id: randomUUID(), path: from });
  await before.dispatch('note', 'written in gnotes/');
  await closeLedgers();

  let started = 0;
  assert.equal(await liftLedger(project, false, () => started++), 'lifted');
  assert.equal(started, 1);
  assert.ok(!(await readdir(project)).includes(OLD_FOLDER));

  const after = await notesOf({ id: randomUUID(), path: project });
  assert.deepEqual(after.state, ['written in gnotes/']);
  await closeLedgers();
});

test('everything moves up, LEDGER included, and gnotes/ is gone', async () => {
  const project = await oldProject();
  assert.equal(await liftLedger(project, false, nothing), 'lifted');
  assert.deepEqual(await sorted(project), [MARKER, 'a', 'b']);
  assert.deepEqual(await readdir(path.join(project, 'a')), [
    '0000000000000001.log',
  ]);
});

test('a move stopped part way is finished by the next', async () => {
  const project = await oldProject();
  // As if it stopped after the first rename: LEDGER is still below.
  await rename(path.join(project, OLD_FOLDER, 'a'), path.join(project, 'a'));

  // Not knowing it started, it sees a folder with other things in it.
  await assert.rejects(liftLedger(project, false, nothing), /other things/);
  assert.equal(await liftLedger(project, true, nothing), 'lifted');
  assert.deepEqual(await sorted(project), [MARKER, 'a', 'b']);
});

test('a move stopped after LEDGER went up has nothing left to do', async () => {
  const project = await oldProject();
  assert.equal(await liftLedger(project, false, nothing), 'lifted');
  assert.equal(await liftLedger(project, true, nothing), 'already');
});

test('a folder that holds other things is refused, and nothing moves', async () => {
  const project = await oldProject();
  await writeFile(path.join(project, 'thesis.tex'), '');

  let started = 0;
  await assert.rejects(
    liftLedger(project, false, () => started++),
    /thesis\.tex/,
  );
  assert.equal(started, 0);
  assert.deepEqual(await sorted(project), [OLD_FOLDER, 'thesis.tex']);
  assert.deepEqual(await sorted(path.join(project, OLD_FOLDER)), [
    MARKER,
    'a',
    'b',
  ]);
});

test('a name already taken at the top is never overwritten', async () => {
  const project = await oldProject(['a']);
  await mkdir(path.join(project, 'a'));
  await writeFile(path.join(project, 'a', 'mine'), '');

  await assert.rejects(liftLedger(project, true, nothing), /already exists/);
  assert.deepEqual(await readdir(path.join(project, 'a')), ['mine']);
  assert.deepEqual(await sorted(path.join(project, OLD_FOLDER)), [MARKER, 'a']);
});

test('the .DS_Store Finder left in gnotes/ does not keep it', async () => {
  const project = await oldProject();
  await writeFile(path.join(project, OLD_FOLDER, '.DS_Store'), '');
  await writeFile(path.join(project, '.DS_Store'), '');

  assert.equal(await liftLedger(project, false, nothing), 'lifted');
  assert.deepEqual(await sorted(project), ['.DS_Store', MARKER, 'a', 'b']);
});

test('a gnotes/ that is not a ledger is left alone', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'pbnotes-lift-'));
  assert.equal(await liftLedger(project, false, nothing), 'none');

  await mkdir(path.join(project, OLD_FOLDER));
  await writeFile(path.join(project, OLD_FOLDER, 'todo.txt'), '');
  assert.equal(await liftLedger(project, false, nothing), 'none');
  assert.deepEqual(await readdir(path.join(project, OLD_FOLDER)), ['todo.txt']);
});
