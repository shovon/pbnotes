/**
 * The disk, as the projects registry asks it things: what a path really is,
 * whether it is a directory, and whether a tracked one can be reached now.
 *
 * The one place in `projects/` that touches the filesystem. `index.ts` makes
 * one and hands it to the store and to `open-project.ts`, which each declare
 * only what they call of it; a test hands them a disk of its own instead.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Availability } from "../../../../shared/projects.ts";

/**
 * A `stat` against an unreachable network share can block for a long time, so
 * a slow probe reports `unknown` instead of stalling the list or being
 * mistaken for a deletion.
 */
const AVAILABILITY_TIMEOUT_MS = 2_000;

export function createDisk(timeoutMs: number = AVAILABILITY_TIMEOUT_MS) {
  /**
   * Resolves `.`/`..` and symlinks so the same directory always keys the same.
   * Rejects for a path that cannot be read.
   */
  function canonicalize(input: string): Promise<string> {
    return fs.realpath(path.resolve(input));
  }

  /** Rejects for a path that cannot be read. */
  async function isDirectory(directory: string): Promise<boolean> {
    return (await fs.stat(directory)).isDirectory();
  }

  /** Never rejects: a path that cannot be read is `missing`, a slow one `unknown`. */
  async function probe(directory: string): Promise<Availability> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Availability>((resolve) => {
      timer = setTimeout(() => resolve("unknown"), timeoutMs);
    });
    const stat = fs.stat(directory).then(
      (stats): Availability => (stats.isDirectory() ? "available" : "missing"),
      (): Availability => "missing",
    );

    try {
      return await Promise.race([stat, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return { canonicalize, isDirectory, probe };
}
