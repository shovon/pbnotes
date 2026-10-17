#!/usr/bin/env node
/**
 * pbnotes append <project-folder> ["text"]
 *
 * Appends one top-level block to the end of today's journal page, reading the
 * text from stdin when it is not given. Writes only: it reads no page and no
 * writer directory but its own, so it needs no fold and no check (#60). A
 * folder that is not a ledger is refused by `openWriter`, which never creates
 * one.
 */
import { text as readAll } from "node:stream/consumers";
import { openWriter } from "@pbnotes/ledger";
import { blockCreated, today } from "@pbnotes/pages";

const [command, folder, ...rest] = process.argv.slice(2);
if (command !== "append" || !folder) {
  console.error('usage: pbnotes append <project-folder> ["text of the block"]');
  process.exit(2);
}

try {
  const text = rest.length ? rest.join(" ") : (await readAll(process.stdin)).replace(/\n$/, "");
  await using w = await openWriter(folder, "pbnotes-cli");
  const e = blockCreated(today(), text);
  await w.post(e.v, e.type, e.payload);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
