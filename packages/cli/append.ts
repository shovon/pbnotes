/**
 * pbnotes append <project-folder> ["text"]
 *
 * Appends one top-level block to the end of today's journal page, reading the
 * text from stdin when it is not given. Writes only: it reads no page and no
 * writer directory but its own, so it needs no fold and no check (#60). A
 * folder that is not a ledger is refused by `openWriter`, which never creates
 * one.
 */
import { randomUUID } from "node:crypto";
import { text as readAll } from "node:stream/consumers";
import { openWriter } from "@pbnotes/ledger";
import { blockCreated, today } from "@pbnotes/graph";
import { USAGE } from "./usage.ts";
import type { Command } from "./usage.ts";

export const append: Command = async ([folder, ...rest]) => {
  if (!folder) return USAGE;
  try {
    const text = rest.length ? rest.join(" ") : (await readAll(process.stdin)).replace(/\n$/, "");
    await using w = await openWriter(folder, "pbnotes-cli");
    // The command is its own composition root: the clock and the id are chosen here.
    const e = blockCreated(today(new Date()), text, undefined, randomUUID());
    await w.post(e.v, e.type, e.payload);
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
};
