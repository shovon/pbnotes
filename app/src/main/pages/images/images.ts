/**
 * Where a project's images are: beside the log, in the folder of the device
 * that added them — `gnotes/<device-id>/images/<sha256>.png`.
 *
 * Per device because of the rule the log lives by: a device writes only
 * inside its own directory, so a sync tool never has two machines on one
 * path. A note does not name the device, though. It links `images/<name>`,
 * and the file is looked for in every device's folder — which is safe because
 * the name is the hash of the bytes: the same name in two folders is the same
 * image, and whichever copy has arrived is the right one.
 *
 * Free of `electron` imports, like the store beside it, so it runs under
 * `node --test`.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
 * A bare file name: no separator, no leading dot. The name comes out of note
 * text, so this is what keeps `images/../../anything` from being a path. Not
 * the hash pattern — a file put in an `images` folder by hand is linked the
 * same way.
 */
const NAME = /^[\w-][\w.-]*$/;

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Stores an image in this device's folder and returns what a note links it
 * by: `images/<sha256>.<ext>`, relative to the log directory.
 *
 * Written under another name and renamed into place, so a crash mid-write
 * never leaves half an image under the name that claims to be its hash.
 */
export async function saveImage(
  directory: string,
  device: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const extension = EXTENSIONS.get(mime);
  if (!extension) throw new Error(`Cannot store an image of type "${mime}".`);

  const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  const folder = path.join(directory, device, IMAGES);
  const file = path.join(folder, name);
  if (!(await isFile(file))) {
    await mkdir(folder, { recursive: true });
    await writeFile(`${file}.tmp`, bytes);
    await rename(`${file}.tmp`, file);
  }
  return `${IMAGES}/${name}`;
}

/**
 * The file a note's `images/<name>` is, from whichever device has it, or
 * undefined: not synced yet, or never there.
 */
export async function findImage(
  directory: string,
  name: string,
): Promise<string | undefined> {
  if (!NAME.test(name)) return undefined;
  let devices: string[];
  try {
    devices = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return undefined;
  }
  for (const device of devices) {
    const file = path.join(directory, device, IMAGES, name);
    if (await isFile(file)) return file;
  }
  return undefined;
}
