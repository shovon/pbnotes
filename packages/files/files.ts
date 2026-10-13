/**
 * Immutable files, named by the hash of their bytes and kept per device in a
 * shared folder: `<directory>/<device-id>/<folder>/<sha256>.<extension>`.
 *
 * Per device because a sync tool is what carries the folder between machines:
 * a device writes only inside its own directory, so two machines are never on
 * one path and there is never a conflicted copy. A reference does not name
 * the device, though. It names the file, and the file is looked for in every
 * device's directory — which is safe because the name is the hash of the
 * bytes: the same name in two directories is the same content, and whichever
 * copy has arrived is the right one.
 *
 * That is the only kind of write this is for. A file that changes has a copy
 * per device and no order between them.
 *
 * Nothing but Node builtins, so it runs under `node --test`.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * A bare file name: no separator, no leading dot. A name may come out of
 * text someone typed, so this is what keeps `../../anything` from being a
 * path. Not the hash pattern — a file put in a device's folder by hand is
 * found the same way.
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
 * Stores `bytes` in this device's `folder` and returns the name to find them
 * by: `<sha256>.<extension>`.
 *
 * `device` is the caller's to supply, and is whichever id it writes as in
 * this directory; none is minted or kept here.
 *
 * Written under another name and renamed into place, so a crash mid-write
 * never leaves half a file under the name that claims to be its hash.
 */
export async function save(
  directory: string,
  device: string,
  folder: string,
  bytes: Uint8Array,
  extension: string,
): Promise<string> {
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  const into = path.join(directory, device, folder);
  const file = path.join(into, name);
  if (!(await isFile(file))) {
    await mkdir(into, { recursive: true });
    await writeFile(`${file}.tmp`, bytes);
    await rename(`${file}.tmp`, file);
  }
  return name;
}

/**
 * The path of `name` in `folder`, from whichever device has it, or undefined:
 * not synced yet, or never there. Reads only, and creates nothing.
 */
export async function find(
  directory: string,
  folder: string,
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
    const file = path.join(directory, device, folder, name);
    if (await isFile(file)) return file;
  }
  return undefined;
}
