/**
 * The edge: read a Logseq graph folder, plan it, store its images and post
 * its events. Everything it touches comes in as a port, so a test can run it
 * over a folder in memory.
 *
 * It writes into whatever writer it is given. Whether a project that already
 * holds events may be imported into is the caller's to decide.
 */
import type { Config } from "../config/config.ts";
import { DEFAULTS, readConfig } from "../config/config.ts";
import { assetLinks } from "../images/images.ts";
import { plan } from "../plan/plan.ts";
import type { SourceFile } from "../plan/plan.ts";
import type { Finding, Report } from "../report.ts";

/** An entry of a folder: its name, and whether it is a folder itself. */
export type Entry = { name: string; folder: boolean };

/**
 * A graph folder, read only. Paths are relative to it, `/` between parts.
 * Each answers undefined for what is not there or cannot be read.
 */
export type Folder = {
  list(path: string): Promise<Entry[] | undefined>;
  text(path: string): Promise<string | undefined>;
  bytes(path: string): Promise<Uint8Array | undefined>;
};

/** Where events go: only `post`, as a ledger `Writer` has it. */
export type Poster = { post(v: number, type: string, payload: unknown): Promise<unknown> };

export type Deps = {
  /** A fresh block id. */
  newId(): string;
  /** Stores an image's bytes under `nameOf(bytes, extension)`. */
  store(bytes: Uint8Array, extension: string): Promise<unknown>;
};

/** The folders whose files are pages. */
const PAGES = new Set(["journals", "pages"]);
/** Top-level folders read for something other than pages, or on demand. */
const READ = new Set(["logseq", "assets"]);

const hidden = (name: string) => name.startsWith(".");

/** The config, and a finding when there is none to read. */
async function configOf(folder: Folder): Promise<{ config: Config; findings: Finding[] }> {
  const text = await folder.text("logseq/config.edn");
  return text === undefined
    ? { config: DEFAULTS, findings: [{ kind: "config-missing" }] }
    : { config: readConfig(text), findings: [] };
}

/** The page files to import, and what was passed over. Hidden entries are passed over silently. */
async function filesOf(folder: Folder): Promise<{ files: SourceFile[]; findings: Finding[] }> {
  const files: SourceFile[] = [];
  const findings: Finding[] = [];
  for (const top of (await folder.list("")) ?? []) {
    if (hidden(top.name)) continue;
    if (top.folder && top.name === "logseq") {
      // Only `config.edn` is read: a conflicted copy beside it, backups and the rest are passed over.
      for (const entry of (await folder.list("logseq")) ?? []) {
        if (hidden(entry.name) || (!entry.folder && entry.name === "config.edn")) continue;
        findings.push({ kind: "skipped", path: `logseq/${entry.name}${entry.folder ? "/" : ""}`, why: "not-pages" });
      }
      continue;
    }
    if (top.folder && READ.has(top.name)) continue;
    if (!top.folder || !PAGES.has(top.name)) {
      findings.push({ kind: "skipped", path: top.folder ? `${top.name}/` : top.name, why: "not-pages" });
      continue;
    }
    for (const entry of (await folder.list(top.name)) ?? []) {
      if (hidden(entry.name)) continue;
      const path = `${top.name}/${entry.name}`;
      if (entry.folder) findings.push({ kind: "skipped", path: `${path}/`, why: "folder" });
      else if (/\.org$/i.test(entry.name)) findings.push({ kind: "skipped", path, why: "org" });
      else if (!/\.md$/i.test(entry.name)) findings.push({ kind: "skipped", path, why: "not-markdown" });
      else {
        const text = await folder.text(path);
        if (text !== undefined) files.push({ path, text });
      }
    }
  }
  return { files, findings };
}

/** The bytes of every asset a file links that can be read, by `assets/<name>`. */
async function assetsOf(folder: Folder, files: readonly SourceFile[]): Promise<Map<string, Uint8Array>> {
  const wanted = new Set(files.flatMap(({ text }) => assetLinks(text).flatMap((link) => (link.asset ? [link.asset] : []))));
  const assets = new Map<string, Uint8Array>();
  for (const path of wanted) {
    const bytes = await folder.bytes(path);
    if (bytes) assets.set(path, bytes);
  }
  return assets;
}

/**
 * Imports the Logseq graph in `from`: its images first, so no link is ever
 * written before what it links, then its events, one at a time in order.
 */
export async function importGraph(from: Folder, writer: Poster, deps: Deps): Promise<Report> {
  const { config, findings: configFindings } = await configOf(from);
  const { files, findings: fileFindings } = await filesOf(from);
  const assets = await assetsOf(from, files);
  const planned = plan({ files, assets }, config, deps.newId);
  for (const { bytes, extension } of planned.images) await deps.store(bytes, extension);
  for (const { v, type, payload } of planned.events) await writer.post(v, type, payload);
  return {
    counts: planned.report.counts,
    findings: [...configFindings, ...fileFindings, ...planned.report.findings],
  };
}
