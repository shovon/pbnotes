/**
 * Main rejects with messages meant for the user to read ("That directory is
 * already tracked as …"), but Electron wraps them in its own IPC prefix on the
 * way across. Strip the plumbing and keep the sentence.
 *
 * Pure, so it runs under `node --test`: the app's notice and a field that
 * shows its own refusal (the page title, #109) read it the same way.
 */
export function humanize(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '');
}
