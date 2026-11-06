/**
 * The adapters `importGraph` runs on in production: a graph folder on disk,
 * and image storage beside a ledger writer. Thin: no rule about Logseq or
 * pbnotes is decided here.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { save } from "@pbnotes/files";
import { IMAGES } from "@pbnotes/files/images";
import type { Folder } from "./import.ts";

/** `root` on disk, read only. A path that would leave it, or anything unreadable, is not there. */
export function diskFolder(root: string): Folder {
  const inside = (relative: string): string | undefined => {
    const full = path.resolve(root, relative);
    const from = path.relative(path.resolve(root), full);
    return from.startsWith("..") || path.isAbsolute(from) ? undefined : full;
  };
  const attempt = async <T>(relative: string, read: (full: string) => Promise<T>): Promise<T | undefined> => {
    const full = inside(relative);
    if (full === undefined) return undefined;
    try {
      return await read(full);
    } catch {
      return undefined;
    }
  };
  return {
    list: (relative) =>
      attempt(relative, async (full) =>
        (await readdir(full, { withFileTypes: true })).map((d) => ({ name: d.name, folder: d.isDirectory() })),
      ),
    text: (relative) => attempt(relative, (full) => readFile(full, "utf8")),
    bytes: (relative) => attempt(relative, async (full) => new Uint8Array(await readFile(full))),
  };
}

/**
 * Stores images beside the ledger writer whose directory is `directory`
 * (`<project>/<writer-id>`): in `<project>/<writer-id>/images/`, as the app
 * stores a pasted one.
 */
export function storeBeside(directory: string): (bytes: Uint8Array, extension: string) => Promise<string> {
  return (bytes, extension) => save(path.dirname(directory), path.basename(directory), IMAGES, bytes, extension);
}
