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
import { readFile } from 'node:fs/promises';
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
 * The type an image was stored as, read off its file's extension, or
 * undefined for a file this module would not have stored.
 */
export function mimeOf(file: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase();
  for (const [mime, it] of EXTENSIONS) if (it === extension) return mime;
  return undefined;
}

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

/** An image a paste wants in the project: its name, and its bytes when the copy carried them. */
export type Wanted = { name: string; bytes?: Uint8Array; mime?: string };

/**
 * Brings what `wanted` names into the project in `directory`, written as
 * `device` (#261), and hands back each one's link, in order, or undefined
 * for one that could not be had. A name the project has already is not
 * stored again. Otherwise the bytes the copy carried are stored, or with
 * none, the file of that name in `from`, the project the copy came out of.
 *
 * Stored under the hash of what was stored, as every image is: bytes that
 * are not what their name says land under a name of their own, and the
 * link handed back is that one.
 */
export async function carryImages(
  directory: string,
  device: string,
  from: string | undefined,
  wanted: readonly Wanted[],
): Promise<(string | undefined)[]> {
  const out: (string | undefined)[] = [];
  for (const { name, bytes, mime } of wanted) {
    if (await findImage(directory, name)) {
      out.push(`${IMAGES}/${name}`);
      continue;
    }
    try {
      if (bytes && mime) {
        out.push(await saveImage(directory, device, bytes, mime));
        continue;
      }
      const file = from === undefined ? undefined : await findImage(from, name);
      const type = file && mimeOf(file);
      out.push(file && type ? await saveImage(directory, device, await readFile(file), type) : undefined);
    } catch {
      // One that cannot be stored is one link left broken, not a paste lost.
      out.push(undefined);
    }
  }
  return out;
}
