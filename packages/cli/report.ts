/**
 * An import's report, worded for a terminal: the counts first, then each
 * kind of finding under a heading, one line per file. Pure: the report in,
 * the text out.
 */
import type { Counts, Finding, Report } from "@pbnotes/logseq";

type Kind = Finding["kind"];
type Of<K extends Kind> = Extract<Finding, { kind: K }>;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function counts(c: Counts): string {
  const parts = [
    plural(c.pages, "page", "pages"),
    plural(c.journals, "journal day", "journal days"),
    plural(c.blocks, "block", "blocks"),
    plural(c.properties, "property", "properties"),
    plural(c.tags, "tag", "tags"),
    plural(c.aliases, "alias", "aliases"),
    plural(c.images, "image", "images"),
  ];
  return `Imported ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}.`;
}

const SKIPPED: Record<Of<"skipped">["why"], string> = {
  org: "Org-mode file",
  folder: "folder inside pages or journals",
  "not-markdown": "not a Markdown file",
  "not-pages": "not imported",
};

const LEFT: Record<Of<"asset-left">["why"], string> = {
  missing: "file not found",
  "not-an-image": "not an image pbnotes stores",
  "not-embedded": "a link, not an embedded image",
  "outside-assets": "points outside assets/",
};

/** Each kind's heading, and how one of it is written, in the order they are printed. */
const SECTIONS: { [K in Kind]: { heading: string; line: (f: Of<K>) => string } } = {
  "config-missing": { heading: "No logseq/config.edn: Logseq's defaults were used", line: () => "" },
  skipped: { heading: "Skipped", line: (f) => `${f.path}  (${SKIPPED[f.why]})` },
  empty: { heading: "Empty, nothing to import", line: (f) => f.path },
  "journal-name-unparsed": {
    heading: "Journal files whose name is not a date, imported as pages",
    line: (f) => `${f.path}  → "${f.title}"`,
  },
  merged: { heading: "Files merged into one page", line: (f) => `"${f.title}": ${f.paths.join(", ")}` },
  "page-named-like-a-day": {
    heading: "Pages named like a journal day, kept apart from the day",
    line: (f) => `${f.path}  (${f.day})`,
  },
  "logbooks-dropped": {
    heading: "LOGBOOK drawers dropped",
    line: (f) => `${f.path}  (${f.count})`,
  },
  "duplicate-id": {
    heading: "Block ids already used, given a new id",
    line: (f) => `${f.path}  ${f.id}  (first in ${f.first})`,
  },
  "dangling-ref": { heading: "Block refs to no block, left as written", line: (f) => `${f.path}  ((${f.id}))` },
  "asset-left": { heading: "Asset links left as written", line: (f) => `${f.path}  ${f.target}  (${LEFT[f.why]})` },
  "blank-list-item": { heading: "Blank items in tags:: or alias::, skipped", line: (f) => `${f.path}  (${f.key}::)` },
};

export function describe(report: Report): string {
  const out = [counts(report.counts)];
  for (const kind of Object.keys(SECTIONS) as Kind[]) {
    const found = report.findings.filter((f) => f.kind === kind);
    if (found.length === 0) continue;
    const { heading, line } = SECTIONS[kind] as { heading: string; line: (f: Finding) => string };
    const lines = found.map(line).filter((it) => it !== "");
    out.push("", lines.length ? `${heading} (${lines.length}):` : `${heading}.`, ...lines.map((it) => `  ${it}`));
  }
  return out.join("\n");
}
