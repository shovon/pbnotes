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
import { carryImages, findImage, mimeOf, saveImage } from './images.ts';

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

test("an image's type is read back off the extension it was stored under", () => {
  assert.equal(mimeOf("/p/d/images/abc.png"), "image/png");
  assert.equal(mimeOf("abc.JPG"), "image/jpeg");
  assert.equal(mimeOf("abc.svg"), "image/svg+xml");
  assert.equal(mimeOf("abc.exe"), undefined);
  assert.equal(mimeOf("abc"), undefined);
});

test('a paste brings what it carried, what the source has, and nothing the project has already', async () => {
  const [source, target] = [await scratch(), await scratch()];
  const big = await saveImage(source, 'device-s', bytes, 'image/png');
  const small = new TextEncoder().encode('small');
  const there = await saveImage(target, 'device-old', new TextEncoder().encode('there'), 'image/png');
  const name = (link: string) => link.slice('images/'.length);
  const smallName = name(await saveImage(await scratch(), 'x', small, 'image/png'));

  const links = await carryImages(target, 'device-t', source, [
    { name: name(there) },
    { name: smallName, bytes: small, mime: 'image/png' },
    { name: name(big) },
    { name: 'gone.png' },
    { name: '../escape.png' },
  ]);
  assert.deepEqual(links, [there, `images/${smallName}`, big, undefined, undefined]);
  // What was there already is not stored a second time, under this session.
  assert.deepEqual((await readdir(path.join(target, 'device-t', 'images'))).sort(), [smallName, name(big)].sort());
  assert.deepEqual(new Uint8Array(await readFile(path.join(target, 'device-t', big))), bytes);
});

test('carried bytes that are not what their name says land under their own name', async () => {
  const target = await scratch();
  const [link] = await carryImages(target, 'device-t', undefined, [
    { name: `${'0'.repeat(64)}.png`, bytes, mime: 'image/png' },
  ]);
  assert.notEqual(link, `images/${'0'.repeat(64)}.png`);
  assert.match(link ?? '', /^images\/[0-9a-f]{64}\.png$/);
});

test('with no source and no bytes, or bytes of a type not taken, there is no link', async () => {
  const target = await scratch();
  assert.deepEqual(
    await carryImages(target, 'device-t', undefined, [
      { name: 'a.png' },
      { name: 'b.png', bytes, mime: 'text/html' },
    ]),
    [undefined, undefined],
  );
});
