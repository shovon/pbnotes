#!/usr/bin/env node
/**
 * pbnotes <command> …
 *
 * Only dispatches: each command is its own file, and its own composition
 * root. No command, an unknown one, or wrong arguments print the usage and
 * exit 2.
 */
import { append } from "./append.ts";
import { importLogseq } from "./import-logseq.ts";
import { USAGE, USAGE_TEXT } from "./usage.ts";
import type { Command } from "./usage.ts";

const COMMANDS: Record<string, Command> = { append, "import-logseq": importLogseq };

const [name, ...args] = process.argv.slice(2);
const command = name !== undefined && Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
const code = command ? await command(args) : USAGE;
if (code === USAGE) console.error(USAGE_TEXT);
process.exitCode = code === USAGE ? 2 : code;
