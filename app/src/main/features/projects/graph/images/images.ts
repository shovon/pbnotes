/**
 * Where a project's images are: beside the log, in the folder of the device
 * that added them — `<project>/<device-id>/images/<sha256>.png`.
 *
 * Kept by `@pbnotes/files`, which is where the reasoning lives: per device,
 * named by the hash of the bytes, and found in whichever device's folder has
 * arrived. What is here is the part that is about images: which types can be
 * stored, the folder they go in, and what a note links one by.
 *
 * Free of `electron` imports, like the store beside it, so it runs under
 * `node --test`.
 */
import { find, save } from '@pbnotes/files';

const IMAGES = 'images';

/** What can be stored, and the extension each is stored under. */
const EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
]);

/**
 * Stores an image in this device's folder and returns what a note links it
 * by: `images/<sha256>.<ext>`, relative to the log directory.
 */
export async function saveImage(
  directory: string,
  device: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const extension = EXTENSIONS.get(mime);
  if (!extension) throw new Error(`Cannot store an image of type "${mime}".`);
  return `${IMAGES}/${await save(directory, device, IMAGES, bytes, extension)}`;
}

/**
 * The file a note's `images/<name>` is, from whichever device has it, or
 * undefined: not synced yet, or never there. The name comes out of note text,
 * and `find` is what refuses one that is not a bare file name.
 */
export function findImage(
  directory: string,
  name: string,
): Promise<string | undefined> {
  return find(directory, IMAGES, name);
}
