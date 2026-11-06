/**
 * A whole Logseq graph, read into what pbnotes writes for it: the events in
 * order, the images to store, and the report. Every file's text and every
 * linked asset's bytes in, data out; no I/O, and the same out for the same
 * in apart from the ids `newId` hands it.
 *
 * Here is where the pieces meet: the outline (`parse`), titles, list
 * properties, dates and image links, and `@pbnotes/graph`'s builders.
 */
import { aliasAdded, blockCreated, canonicalize, dateOf, propertySet, read, tagAdded } from "@pbnotes/graph";
import type { Batched } from "@pbnotes/graph";
import { nameOf } from "@pbnotes/files";
import { extensionOf, linkOf, mimeOf } from "@pbnotes/files/images";
import type { Config } from "../config/config.ts";
import { format, parse as parseDay } from "../dates/dates.ts";
import { assetLinks, relinked } from "../images/images.ts";
import type { AssetLink } from "../images/images.ts";
import { namesIn } from "../lists/lists.ts";
import { parse } from "../parse/parse.ts";
import type { Tree } from "../parse/parse.ts";
import { dayOfFile, titleOfFile } from "../titles/titles.ts";
import type { Counts, Finding, Report } from "../report.ts";

/** A page or journal file: `journals/<name>.md` or `pages/<name>.md`, and its text. */
export type SourceFile = { path: string; text: string };

/** Every file to import, and the bytes of each linked asset that exists, by `assets/<name>`. */
export type Source = { files: readonly SourceFile[]; assets: ReadonlyMap<string, Uint8Array> };

/** An image to store under `name`, which is `nameOf(bytes, extension)`. */
export type Image = { name: string; extension: string; bytes: Uint8Array };

export type Plan = { events: Batched[]; images: Image[]; report: Report };

/** The journal title formats every day answers to with nothing written (#221). */
const BUILT_IN = new Set(["MMM do, yyyy", "MMMM do, yyyy"]);

const UUID_REF = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi;

/** One file, read: its title and whether that is a journal day. */
type Read = {
  path: string;
  title: string;
  day: string | undefined;
  properties: [string, string][];
  blocks: Tree[];
};

/** A page: every file whose title is it, in path order. */
type Group = { title: string; day: string | undefined; files: Read[] };

const nameOfPath = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

function* walk(trees: readonly Tree[]): Generator<Tree> {
  for (const tree of trees) {
    yield tree;
    yield* walk(tree.children);
  }
}

const empty = (trees: readonly Tree[]): boolean =>
  trees.every((tree) => tree.text.trim() === "" && !tree.id && empty(tree.children));

/** Every key of `properties` named `key`, any case. */
const valuesOf = (properties: readonly [string, string][], key: string) =>
  properties.filter(([k]) => k.toLowerCase() === key).map(([, value]) => value);

export function plan(source: Source, config: Config, newId: () => string): Plan {
  const findings: Finding[] = [];
  const counts: Counts = { pages: 0, journals: 0, blocks: 0, properties: 0, tags: 0, aliases: 0, images: 0 };
  const custom = !BUILT_IN.has(config.journalTitles);
  const dayOfTitle = (title: string) => dateOf(title) ?? (custom ? parseDay(config.journalTitles, title) : undefined);

  // ── Each file: its outline and its title ──────────────────────────────────
  const reads: Read[] = [];
  for (const { path, text } of [...source.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const parsed = parse(text);
    if (parsed.logbooks > 0) findings.push({ kind: "logbooks-dropped", path, count: parsed.logbooks });
    if (parsed.properties.length === 0 && empty(parsed.blocks)) {
      findings.push({ kind: "empty", path });
      continue;
    }
    const name = nameOfPath(path);
    const journal = path.startsWith("journals/");
    const day = journal ? dayOfFile(name, config.journalFiles) : undefined;
    const title = day ?? valuesOf(parsed.properties, "title")[0] ?? titleOfFile(name, config.fileNames);
    if (journal && !day) findings.push({ kind: "journal-name-unparsed", path, title });
    if (!day) {
      const named = dayOfTitle(title);
      if (named) findings.push({ kind: "page-named-like-a-day", path, title, day: named });
    }
    reads.push({ path, title, day, properties: parsed.properties, blocks: parsed.blocks });
  }

  // ── Files that are one page ───────────────────────────────────────────────
  const groups = new Map<string, Group>();
  for (const it of reads) {
    const key = canonicalize(it.title);
    const group = groups.get(key);
    if (group) group.files.push(it);
    else groups.set(key, { title: it.title, day: it.day, files: [it] });
  }
  for (const group of groups.values()) {
    if (group.files.length > 1) findings.push({ kind: "merged", title: group.title, paths: group.files.map((f) => f.path) });
  }

  // ── Ids: an `id::` is kept by its first block in path order ───────────────
  const ids = new Map<Tree, string>();
  const owners = new Map<string, string>();
  for (const it of reads) {
    for (const tree of walk(it.blocks)) {
      const id = tree.id?.toLowerCase();
      if (id && !owners.has(id)) {
        owners.set(id, it.path);
        ids.set(tree, tree.id!);
        continue;
      }
      if (id) findings.push({ kind: "duplicate-id", path: it.path, id: tree.id!, first: owners.get(id)! });
      ids.set(tree, newId());
    }
  }

  // ── Images, and each block's text as it is written ────────────────────────
  const images = new Map<string, Image>();
  const textOf = (tree: Tree, path: string): string => {
    const swaps = new Map<AssetLink, string>();
    for (const link of assetLinks(tree.text)) {
      const left = (why: "missing" | "not-an-image" | "not-embedded" | "outside-assets") =>
        findings.push({ kind: "asset-left", path, target: link.target, why });
      if (link.asset === undefined) {
        left("outside-assets");
        continue;
      }
      const bytes = source.assets.get(link.asset);
      const mime = mimeOf(link.asset);
      const extension = mime && extensionOf(mime);
      if (!bytes) left("missing");
      else if (!extension) left("not-an-image");
      else if (!link.embed) left("not-embedded");
      else {
        const name = nameOf(bytes, extension);
        images.set(name, { name, extension, bytes });
        swaps.set(link, `![${link.alt}](${linkOf(name)})`);
      }
    }
    const text = swaps.size > 0 ? relinked(tree.text, swaps) : tree.text;
    for (const [, ref] of text.matchAll(UUID_REF)) {
      if (!owners.has(ref.toLowerCase())) findings.push({ kind: "dangling-ref", path, id: ref });
    }
    return text;
  };

  // ── A custom journal title format: each day's names in it, as aliases ─────
  const dayNames = new Map<string, string[]>();
  if (custom) {
    const name = (day: string, spelling: string) => {
      // A name with a page of its own is that page's, never the day's (#221).
      if (groups.has(canonicalize(spelling))) return;
      const names = dayNames.get(day) ?? [];
      // Spellings that differ only in case are one name to pbnotes.
      if (!names.some((it) => canonicalize(it) === canonicalize(spelling))) names.push(spelling);
      dayNames.set(day, names);
    };
    for (const group of groups.values()) {
      const spelled = group.day && format(config.journalTitles, group.day);
      if (group.day && spelled) name(group.day, spelled);
    }
    for (const it of reads) {
      const texts = [...[...walk(it.blocks)].map((tree) => tree.text), ...it.properties.map(([, value]) => value)];
      for (const text of texts) {
        for (const link of read(text).links) {
          const day = parseDay(config.journalTitles, link);
          if (day) name(day, link);
        }
      }
    }
  }

  // ── Events, page by page ──────────────────────────────────────────────────
  const events: Batched[] = [];
  const push = (it: Batched) => events.push({ type: it.type, v: it.v, payload: it.payload });
  const aliasesOf = (page: string, names: readonly string[]) => {
    for (const alias of names) {
      push(aliasAdded(page, alias));
      counts.aliases++;
    }
  };

  for (const group of groups.values()) {
    const page = group.title;
    if (group.day) counts.journals++;
    else counts.pages++;
    for (const file of group.files) {
      const write = (trees: readonly Tree[], parent: string | undefined) => {
        let after: string | undefined;
        for (const tree of trees) {
          const id = ids.get(tree)!;
          // At the top, no `after`: each lands at the end of the page, so a
          // second file's blocks follow the first's. Under a parent, after
          // the sibling before it, or first.
          push(blockCreated(page, textOf(tree, file.path), parent ? after : undefined, id, parent));
          counts.blocks++;
          write(tree.children, id);
          after = id;
        }
      };
      write(file.blocks, undefined);
    }

    const tags = new Set<string>();
    const aliases = new Set<string>();
    for (const file of group.files) {
      for (const [key, value] of file.properties) {
        const lower = key.toLowerCase();
        if (lower === "title") continue;
        if (lower === "tags" || lower === "alias") {
          const { names, blanks } = namesIn(value);
          for (let i = 0; i < blanks; i++) findings.push({ kind: "blank-list-item", path: file.path, key });
          for (const it of names) {
            const seen = lower === "tags" ? tags : aliases;
            if (seen.has(canonicalize(it))) continue;
            seen.add(canonicalize(it));
            if (lower === "tags") {
              push(tagAdded(page, it));
              counts.tags++;
            } else aliasesOf(page, [it]);
          }
          continue;
        }
        push(propertySet(page, key, value));
        counts.properties++;
      }
    }
    if (group.day) {
      aliasesOf(page, dayNames.get(group.day) ?? []);
      dayNames.delete(group.day);
    }
  }

  // Days a link names that have no file of their own.
  for (const day of [...dayNames.keys()].sort()) aliasesOf(day, dayNames.get(day)!);

  counts.images = images.size;
  return { events, images: [...images.values()], report: { counts, findings } };
}
