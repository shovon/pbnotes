/**
 * What makes a title a journal day. Whoever writes picks the day, so the fold
 * never has to hold an opinion about the user's timezone; this only tells the
 * journal apart from the pages that links name.
 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today as `YYYY-MM-DD`, in the user's local time. Not `toISOString()`, which
 * is UTC and hands the wrong page to anyone whose evening is already tomorrow
 * in Greenwich.
 *
 * Shared because everyone who writes the journal needs the same day: the
 * app's main, its renderer and the CLI.
 */
export function today(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
