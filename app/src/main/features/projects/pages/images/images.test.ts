/**
 * Run with: npm test
 *
 * Storing and finding are `@pbnotes/files`' and are tested there. What is
 * checked here is what this file adds: where an image lands on disk, what a
 * note links it by, and which types are taken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findImage, saveImage } from './images.ts';

const scratch = () => mkdtemp(path.join(tmpdir(), 'pbnotes-images-'));
const bytes = new TextEncoder().encode('not really a png');

test('an image lands in the device that added it and is linked as images/<hash>', async () => {
  const dir = await scratch();
  const link = await saveImage(dir, 'device-a', bytes, 'image/png');
  assert.match(link, /^images\/[0-9a-f]{64}\.png$/);

  // `<device>/images/<hash>.png`: the layout on disk, which does not change.
  assert.deepEqual(await readdir(dir), ['device-a']);
  const file = path.join(dir, 'device-a', link);
  assert.equal(await findImage(dir, link.slice('images/'.length)), file);
  assert.deepEqual(new Uint8Array(await readFile(file)), bytes);
});

test('a name out of note text cannot leave the images folders', async () => {
  const dir = await scratch();
  await saveImage(dir, 'device-a', bytes, 'image/png');
  for (const name of ['../../device-a', '..', '', 'a/b.png', '.hidden']) {
    assert.equal(await findImage(dir, name), undefined, name);
  }
});

test('a type that is not an image is refused', async () => {
  const dir = await scratch();
  await assert.rejects(saveImage(dir, 'device-a', bytes, 'text/html'));
  assert.deepEqual(await readdir(dir), []);
});
