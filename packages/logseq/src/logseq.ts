/**
 * `@pbnotes/logseq`: a Logseq file-based ("Markdown mode") graph folder,
 * written into a pbnotes project (#204).
 *
 * Three layers, pure in the middle and I/O only at the edge:
 *
 * - `parse(text)`: one file's outline.
 * - `plan(source, config, newId)`: every file into events, images and a report.
 * - `importGraph(from, writer, deps)`: reads a folder, plans it, stores its
 *   images and posts its events.
 *
 * A caller in Node wires it as:
 *
 * ```ts
 * await using writer = await openWriter(project, "pbnotes-import");
 * const report = await importGraph(diskFolder(graph), writer, {
 *   newId: randomUUID,
 *   store: storeBeside(writer.directory),
 * });
 * ```
 */
export { parse } from "./parse/parse.ts";
export type { Parsed, Tree } from "./parse/parse.ts";
export { readConfig, DEFAULTS } from "./config/config.ts";
export type { Config } from "./config/config.ts";
export { plan } from "./plan/plan.ts";
export type { Image, Plan, Source, SourceFile } from "./plan/plan.ts";
export { importGraph } from "./import/import.ts";
export type { Deps, Entry, Folder, Poster } from "./import/import.ts";
export { diskFolder, storeBeside } from "./import/disk.ts";
export type { Counts, Finding, Report } from "./report.ts";
