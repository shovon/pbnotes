/**
 * What an import did, for the caller to word: counts, and each thing that
 * was skipped, dropped, merged or left as written, with its file. Data, not
 * text: the CLI and the app each say it their own way.
 *
 * Paths are relative to the graph folder, with `/` between parts.
 */

export type Counts = {
  pages: number;
  journals: number;
  blocks: number;
  properties: number;
  tags: number;
  aliases: number;
  images: number;
};

export type Finding =
  /** No readable `logseq/config.edn`: Logseq's defaults were used. */
  | { kind: "config-missing" }
  /** Not imported: an `.org` file, a folder inside `pages/` or `journals/`, a top-level folder or file that holds no pages. */
  | { kind: "skipped"; path: string; why: "org" | "folder" | "not-markdown" | "not-pages" }
  /** A file with no properties and no writing in it. */
  | { kind: "empty"; path: string }
  /** A journal file whose name doesn't parse in `:journal/file-name-format`: imported as a page. */
  | { kind: "journal-name-unparsed"; path: string; title: string }
  /** Files whose titles are one page: their blocks follow each other in path order. */
  | { kind: "merged"; title: string; paths: string[] }
  /** A page file named like a journal day: a page of its own, apart from the day. */
  | { kind: "page-named-like-a-day"; path: string; title: string; day: string }
  /** `:LOGBOOK:` drawers dropped from a file. */
  | { kind: "logbooks-dropped"; path: string; count: number }
  /** An `id::` an earlier file's block already had: this block got a fresh id. */
  | { kind: "duplicate-id"; path: string; id: string; first: string }
  /** A `((uuid))` with no block of that id in the graph: left as written. */
  | { kind: "dangling-ref"; path: string; id: string }
  /** An `assets/` link left as written. */
  | { kind: "asset-left"; path: string; target: string; why: "missing" | "not-an-image" | "not-embedded" | "outside-assets" }
  /** An item of a `tags::` or `alias::` value that reads as nothing. */
  | { kind: "blank-list-item"; path: string; key: string };

export type Report = { counts: Counts; findings: Finding[] };
