/**
 * Argument guards for the `ipcMain.handle` boundary.
 *
 * Everything arriving over IPC is `unknown`: the renderer is the one place the
 * main process takes input it did not produce, and these values go on to name
 * pages and blocks in a log that keeps whatever it is given forever. Checking
 * them here is cheaper than finding out from the fold.
 *
 * Here rather than in one of the two IPC files because both need them, and a
 * second copy of a type guard is how two boundaries come to disagree about
 * what they accept.
 */
export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${label} to be a string`);
  }
  return value;
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`Expected ${label} to be a string[]`);
  }
  return value as string[];
}
