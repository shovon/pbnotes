/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGES, extensionOf, linkOf, mimeOf } from './images.ts';

test('the types stored, and the extension each is stored under', () => {
  assert.equal(extensionOf('image/png'), 'png');
  assert.equal(extensionOf('image/jpeg'), 'jpg');
  assert.equal(extensionOf('image/svg+xml'), 'svg');
  assert.equal(extensionOf('application/pdf'), undefined);
});

test('a file is typed by its extension, in any case, jpeg included', () => {
  assert.equal(mimeOf('/p/d/images/abc.png'), 'image/png');
  assert.equal(mimeOf('abc.JPG'), 'image/jpeg');
  assert.equal(mimeOf('abc.jpeg'), 'image/jpeg');
  assert.equal(mimeOf('abc.webp'), 'image/webp');
  assert.equal(mimeOf('abc.pdf'), undefined);
  assert.equal(mimeOf('abc'), undefined);
});

test('a note links an image by images/<name>', () => {
  assert.equal(IMAGES, 'images');
  assert.equal(linkOf('ab12.png'), 'images/ab12.png');
});
