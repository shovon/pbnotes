/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { find, save } from './files.ts';

const scratch = () => mkdtemp(path.join(tmpdir(), 'pbnotes-files-'));
const bytes = new TextEncoder().encode('any bytes at all');

test('a file is stored in the device that added it and found by name alone', async () => {
  const dir = await scratch();
  const name = await save(dir, 'device-a', 'kept', bytes, 'bin');
  assert.match(name, /^[0-9a-f]{64}\.bin$/);

  // Only inside the device's own folder; nothing at the top of the directory.
  assert.deepEqual(await readdir(dir), ['device-a']);
  const file = path.join(dir, 'device-a', 'kept', name);
  assert.equal(await find(dir, 'kept', name), file);
  assert.deepEqual(new Uint8Array(await readFile(file)), bytes);

  // The same bytes again: the same name, and no second file or leftover.
  assert.equal(await save(dir, 'device-a', 'kept', bytes, 'bin'), name);
  assert.equal((await readdir(path.join(dir, 'device-a', 'kept'))).length, 1);
});

test("another device's file is found by the same name", async () => {
  const dir = await scratch();
  await mkdir(path.join(dir, 'device-b', 'kept'), { recursive: true });
  await writeFile(path.join(dir, 'device-b', 'kept', 'shed.bin'), bytes);
  assert.equal(
    await find(dir, 'kept', 'shed.bin'),
    path.join(dir, 'device-b', 'kept', 'shed.bin'),
  );
  assert.equal(await find(dir, 'kept', 'missing.bin'), undefined);
  // One folder's files are not another's.
  assert.equal(await find(dir, 'other', 'shed.bin'), undefined);
});

test('a name cannot leave the folder it is looked for in', async () => {
  const dir = await scratch();
  await mkdir(path.join(dir, 'device-a', 'kept'), { recursive: true });
  await writeFile(path.join(dir, 'device-a', 'secret.log'), 'x');
  for (const name of ['../secret.log', '..', '.', '', 'a/b.bin', '.hidden']) {
    assert.equal(await find(dir, 'kept', name), undefined, name);
  }
});

test('looking in a directory that is not there finds nothing and makes nothing', async () => {
  const dir = path.join(await scratch(), 'absent');
  assert.equal(await find(dir, 'kept', 'shed.bin'), undefined);
  await assert.rejects(readdir(dir));
});
