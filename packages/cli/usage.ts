/** What every command is, and what one hands back when its arguments are wrong. */

/** A command: its arguments in, an exit code (or `USAGE`) out. */
export type Command = (args: string[]) => Promise<number | typeof USAGE>;

/** Handed back by a command whose arguments are wrong: the dispatcher prints the usage and exits 2. */
export const USAGE = Symbol("usage");

export const USAGE_TEXT = [
  'usage: pbnotes append <project-folder> ["text of the block"]',
  "       pbnotes import-logseq <logseq-graph-folder> <project-folder>",
].join("\n");
