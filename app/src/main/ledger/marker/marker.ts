/**
 * The marker: the one file that says a directory is a ledger, and which
 * version of the format it holds.
 *
 * Without it a log would open on whatever path it was handed — the wrong
 * folder, a path that was mistyped — write a device directory there, and read
 * every subdirectory it found as a device. A directory's shape is a hint.
 * This is the claim, and nothing opens without it.
 *
 * Three calls, on purpose. `requireLedger` only looks, and is what `open`
 * rests on. `createLedger` and `adoptLedger` are the two ways a marker comes
 * to exist, and each is something the caller has to mean.
 */
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** At the top of the directory, beside the device directories. */
export const MARKER = 'LEDGER';

/** The format this build reads and writes. 1 is everything before markers. */
export const FORMAT = 1;

/**
 * What kind of directory this is: 128 random bits, the same in every ledger
 * there will ever be, and never changed. The version is the two numbers under
 * it; this line has none, so that no later format has a reason to touch it.
 */
const SIGNATURE = 'Signature: bULhVFqraHDHescwKKhK0g==';

/**
 * Every build of one version writes these bytes and no others: no id, no
 * date, nothing a second writer would put differently. Two machines that
 * create the same directory before they sync produce the same file.
 *
 * The `#` lines are for a person who finds the file and wonders whether it
 * can go. They are skipped on read, so the wording is free to improve.
 */
const CONTENT = `${SIGNATURE}
# This folder is an append-only event ledger. Each subfolder belongs to one
# device. Do not edit, rename or delete anything here by hand.
read ${FORMAT}
write ${FORMAT}
`;

const SEGMENT = /^\d{16}\.log$/;

/**
 * Why a directory cannot be opened. Four reasons and not one, because what to
 * do next is different for each and is the caller's to decide:
 *
 * - `missing`: not there, or empty. `createLedger` makes it one.
 * - `unmarked`: no marker, but a device directory holds a segment. Written
 *   before markers, or the marker has not arrived yet. `adoptLedger` claims it.
 * - `not-a-ledger`: something else is here. Nothing makes it one.
 * - `newer`: a format this build does not know. Only a newer build may open it.
 */
export type Refusal = 'missing' | 'unmarked' | 'not-a-ledger' | 'newer';

const WHY: Record<Refusal, string> = {
  missing: 'there is nothing there yet',
  unmarked: 'it holds a log but no LEDGER file to say it is a ledger',
  'not-a-ledger': 'it has no valid LEDGER file and does not hold a log',
  newer: 'it was written by a newer version, which this one must not write to',
};

export class LedgerRefusedError extends Error {
  // Plain fields, as in `LogCorruptError`: parameter properties are not
  // erasable, and Node runs these files by erasing their types.
  reason: Refusal;
  directory: string;

  constructor(reason: Refusal, directory: string) {
    super(`Cannot open ${directory} as a ledger: ${WHY[reason]}.`);
    this.name = 'LedgerRefusedError';
    this.reason = reason;
    this.directory = directory;
  }
}

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * The versions a marker asks for, or null for anything that is not one.
 * Strict: the signature exactly, then `read N` and `write N`, each line ended
 * by one newline. A file that is nearly right was not written by this code.
 */
function parse(text: string): { read: number; write: number } | null {
  const lines = text.split('\n');
  if (lines.pop() !== '' || lines.shift() !== SIGNATURE) return null;
  const rest = lines.filter((line) => !line.startsWith('#'));
  if (rest.length !== 2) return null;
  const read = /^read ([1-9]\d*)$/.exec(rest[0]);
  const write = /^write ([1-9]\d*)$/.exec(rest[1]);
  return read && write
    ? { read: Number(read[1]), write: Number(write[1]) }
    : null;
}

/**
 * Whether a device directory somewhere in here holds a segment. This is the
 * shape check, and it is only ever asked about a directory with no marker.
 */
async function holdsLog(directory: string, names: string[]): Promise<boolean> {
  for (const name of names) {
    let files: string[];
    try {
      files = await readdir(path.join(directory, name));
    } catch {
      continue;
    }
    if (files.some((file) => SEGMENT.test(file))) return true;
  }
  return false;
}

/**
 * What `directory` is. Reads only, and creates nothing.
 *
 * An error that is not "no such file" is thrown and not turned into a
 * verdict: a marker that cannot be read right now — an online-only
 * placeholder, a drive going away — says nothing about what the directory is.
 */
export async function inspect(directory: string): Promise<'ledger' | Refusal> {
  let text: string | undefined;
  try {
    text = await readFile(path.join(directory, MARKER), 'utf8');
  } catch (error) {
    // The path is a file, or `LEDGER` is a directory.
    if (code(error) === 'ENOTDIR' || code(error) === 'EISDIR') {
      return 'not-a-ledger';
    }
    if (code(error) !== 'ENOENT') throw error;
  }

  if (text !== undefined) {
    const marker = parse(text);
    if (!marker) return 'not-a-ledger';
    // This build writes as well as reads, so it has to meet both.
    return marker.read > FORMAT || marker.write > FORMAT ? 'newer' : 'ledger';
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (code(error) === 'ENOENT') return 'missing';
    throw error;
  }
  // A `.DS_Store` is not content. Finder leaves one in a folder it was only
  // asked to show, and that must not be what stops a ledger being made there.
  const visible = entries.filter((entry) => !entry.name.startsWith('.'));
  if (visible.length === 0) return 'missing';

  const directories = visible
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return (await holdsLog(directory, directories)) ? 'unmarked' : 'not-a-ledger';
}

/** Throws a `LedgerRefusedError` unless `directory` is a ledger this build may open. */
export async function requireLedger(directory: string): Promise<void> {
  const found = await inspect(directory);
  if (found !== 'ledger') throw new LedgerRefusedError(found, directory);
}

/**
 * Written once and never again. An exclusive create, so a marker that landed
 * in the meantime — from a sync tool, most likely — is left exactly as it is;
 * every writer puts the same bytes, so whichever is there is the right one.
 */
async function mark(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(path.join(directory, MARKER), 'wx');
  } catch (error) {
    if (code(error) === 'EEXIST') return;
    throw error;
  }
  try {
    await handle.writeFile(CONTENT);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Makes `directory` a ledger. Only where there is nothing: a directory that
 * holds anything is refused, whatever it holds.
 */
export async function createLedger(directory: string): Promise<void> {
  const found = await inspect(directory);
  if (found !== 'missing') {
    throw new Error(`Cannot create a ledger in ${directory}: it is not empty.`);
  }
  await mkdir(directory, { recursive: true });
  await mark(directory);
}

/**
 * Claims a directory that holds a log and no marker, and changes nothing
 * else in it. Refused for anything that does not already look like a ledger.
 */
export async function adoptLedger(directory: string): Promise<void> {
  const found = await inspect(directory);
  if (found !== 'unmarked') {
    throw new Error(
      `Cannot adopt ${directory}: it is not an unmarked ledger.`,
    );
  }
  await mark(directory);
}
