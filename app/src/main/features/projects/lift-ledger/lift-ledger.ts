/**
 * Moves a project's ledger out of `<project>/gnotes/` and up into the project
 * folder, once (#42). Projects used to keep it one level down; now the folder
 * a project names is its ledger.
 *
 * Every step is a rename, so a device directory is never in neither place.
 * `LEDGER` goes last: the move is done only once it is at the top, so a move
 * that stopped part way is finished by the next open. Nothing is overwritten
 * and nothing is deleted but an empty `gnotes/` and the `.DS_Store` in it.
 *
 * Temporary, like #39's rewrite: once every folder in use has moved, this
 * goes, and with it the name `gnotes`.
 */
import { readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { MARKER, adoptLedger, inspect } from '@pbnotes/ledger';

export const OLD_FOLDER = 'gnotes';

/**
 * - `already`: `LEDGER` is at the top. There is nothing left to do.
 * - `lifted`: it was not, and now is.
 * - `none`: `gnotes/` is not a ledger, so there is nothing to move.
 */
export type Lift = 'already' | 'lifted' | 'none';

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (code(error) === 'ENOENT') return false;
    throw error;
  }
}

/** What Finder and sync tools leave is not content. */
async function visible(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => !name.startsWith('.'));
}

/**
 * `resuming` says a move of this folder has already started, which is the
 * only way the project folder may hold anything besides `gnotes/`: what is
 * there was moved up by that start. `starting` is called before the first
 * rename, so the caller can record that it began.
 *
 * Throws, having moved nothing more, when a name to move up is already taken,
 * or when a move that has not started finds other things in the folder.
 */
export async function liftLedger(
  project: string,
  resuming: boolean,
  starting: () => void,
): Promise<Lift> {
  if (await exists(path.join(project, MARKER))) return 'already';

  const from = path.join(project, OLD_FOLDER);
  const found = await inspect(from);
  if (found !== 'ledger' && found !== 'unmarked') return 'none';

  const others = (await visible(project)).filter((name) => name !== OLD_FOLDER);
  if (!resuming && others.length > 0) {
    throw new Error(
      `Cannot move the notes in ${from} up into ${project}: ` +
        `it holds other things too (${others.join(', ')}).`,
    );
  }

  starting();
  // Temporary (#36), as in `index.ts`: a folder from before markers gets one.
  if (found === 'unmarked') await adoptLedger(from);

  const names = (await visible(from)).filter((name) => name !== MARKER);
  for (const name of [...names, MARKER]) {
    const source = path.join(from, name);
    const target = path.join(project, name);
    if (await exists(target)) {
      // Gone from here and there already: another machine moved it, and the
      // sync tool brought its rename.
      if (!(await exists(source))) continue;
      throw new Error(`Cannot move ${source} up: ${target} already exists.`);
    }
    try {
      await rename(source, target);
    } catch (error) {
      if (code(error) === 'ENOENT' && (await exists(target))) continue;
      throw error;
    }
  }

  await rm(path.join(from, '.DS_Store'), { force: true });
  try {
    await rmdir(from);
  } catch (error) {
    // Something arrived while it moved, or something here is not ours to
    // remove. Either way it stays, and is not deleted.
    if (code(error) !== 'ENOENT' && code(error) !== 'ENOTEMPTY') throw error;
  }
  return 'lifted';
}
