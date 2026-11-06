/**
 * pbnotes import-logseq <logseq-graph-folder> <project-folder>
 *
 * Imports a Logseq Markdown graph into a new pbnotes project (#220). A thin
 * entry point over `importGraph` (#204): every import rule is there.
 *
 * The project must be new: a missing or empty folder is made a ledger, and a
 * ledger that already holds events, from any writer, is refused with nothing
 * written, so a second run cannot duplicate anything. A folder that is
 * neither is refused by `openOrCreate`.
 */
import { randomUUID } from "node:crypto";
import { openOrCreate, openWriter } from "@pbnotes/ledger";
import { diskFolder, importGraph, storeBeside } from "@pbnotes/logseq";
import { describe } from "./report.ts";
import { USAGE } from "./usage.ts";
import type { Command } from "./usage.ts";

export const importLogseq: Command = async (args) => {
  const [graph, project] = args;
  if (!graph || !project || args.length > 2) return USAGE;
  try {
    const from = diskFolder(graph);
    const top = await from.list("");
    if (!top) throw new Error(`${graph} is not a folder that can be read`);
    // Checked before the project is made, so a wrong path creates nothing.
    if (!top.some((it) => it.folder && (it.name === "pages" || it.name === "journals"))) {
      throw new Error(`${graph} is not a Logseq graph: it has no pages or journals folder`);
    }

    const ledger = await openOrCreate(project);
    // A writer whose log can't be read yet may hold events too.
    const held = ledger.status.devices.some((d) => d.folded > 0 || d.state !== "ok");
    await ledger.close();
    if (held) throw new Error(`${project} already holds notes; import-logseq only imports into a new, empty project`);

    await using writer = await openWriter(project, "logseq-import");
    const report = await importGraph(from, writer, { newId: randomUUID, store: storeBeside(writer.directory) });
    console.log(describe(report));
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
};
