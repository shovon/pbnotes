/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findImage, saveImage } from './images.ts';

const scratch = () => mkdtemp(path.join(tmpdir(), 'pbnotes-images-'));
const bytes = new TextEncoder().encode('not really a png');

test('an image is stored in the device that added it and found by name alone', async () => {
  const dir = await scratch();
  const link = await saveImage(dir, 'device-a', bytes, 'image/png');
  assert.match(link, /^images\/[0-9a-f]{64}\.png$/);

  // Only inside the device's own folder; nothing at the top of the directory.
  assert.deepEqual(await readdir(dir), ['device-a']);
  const file = path.join(dir, 'device-a', link);
  assert.equal(await findImage(dir, link.slice('images/'.length)), file);
  assert.deepEqual(new Uint8Array(await readFile(file)), bytes);

  // The same bytes again: the same name, and no second file or leftover.
  assert.equal(await saveImage(dir, 'device-a', bytes, 'image/png'), link);
  assert.equal((await readdir(path.join(dir, 'device-a', 'images'))).length, 1);
});

test("another device's image resolves through the same link", async () => {
  const dir = await scratch();
  await mkdir(path.join(dir, 'device-b', 'images'), { recursive: true });
  await writeFile(path.join(dir, 'device-b', 'images', 'shed.png'), bytes);
  assert.equal(
    await findImage(dir, 'shed.png'),
    path.join(dir, 'device-b', 'images', 'shed.png'),
  );
  assert.equal(await findImage(dir, 'missing.png'), undefined);
});

test('a name out of note text cannot leave the images folders', async () => {
  const dir = await scratch();
  await mkdir(path.join(dir, 'device-a', 'images'), { recursive: true });
  await writeFile(path.join(dir, 'device-a', 'secret.log'), 'x');
  for (const name of ['../secret.log', '..', '.', '', 'a/b.png', '.hidden']) {
    assert.equal(await findImage(dir, name), undefined, name);
  }
});

test('a type that is not an image is refused', async () => {
  const dir = await scratch();
  await assert.rejects(saveImage(dir, 'device-a', bytes, 'text/html'));
  assert.deepEqual(await readdir(dir), []);
});
