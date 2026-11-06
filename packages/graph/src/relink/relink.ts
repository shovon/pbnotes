/**
 * Pointing a block's links at another page (#108): the text with every link
 * whose page `names` picks rewritten to name `to`, and nothing else in it
 * touched. What a rename does to the text of every block.
 *
 * Read with the parser the renderer reads with, the way the walk in
 * `wikilink.ts` reads a note, so a link in code or math, inside a URL, or in
 * an alias's label is left as text here as it renders as text there. The
 * edits go into the source at the positions the parse gives, never through a
 * string replace on the whole text, and nothing is rebuilt from the tree.
 *
 * Text in, text out: nothing here knows a block, a page or a fold.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Link, Root, RootContent } from "mdast";
import { bare, bareTag, matchFrom, remarkPlugins } from "../wikilink/wikilink.ts";
import type { Match } from "../wikilink/wikilink.ts";

/** Parsed only: the plugins' walk drops the positions this reads. */
const md = unified().use(remarkParse).use(remarkPlugins);

type Node = Root | RootContent;

/** A text or a bare URL: what the walk reads together as one run. Not a type guard, so a link that is not bare stays a link. */
const runs = (node: RootContent): boolean => node.type === "text" || bare(node);

/** One change to the source: `text.slice(start, end)` becomes `with`. */
type Edit = { start: number; end: number; with: string };

/** Where a node is in the source, or undefined for one the parse left unplaced. */
function span(node: Node): { start: number; end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

/** What a link becomes: the same form, naming `to`, a bare tag bracketed when `to` needs it. */
function rewrite(match: Extract<Match, { kind: "link" }>, at: number, to: string): Edit {
  if (match.form === "tag" && !bareTag(to)) {
    return { start: at + match.index, end: at + match.index + match.length, with: `#[[${to}]]` };
  }
  const start = at + match.name.index;
  return { start, end: start + match.name.length, with: to };
}

/**
 * The links in a run of text and bare URLs, read as the walk's `split` reads
 * one: the run as the one string it was typed as, and whichever of a URL and
 * a link starts first swallowing what overlaps it.
 */
function inRun(text: string, run: Node[], names: (page: string) => boolean, to: string): Edit[] {
  const placed = run.map(span);
  if (placed.some((it) => it === undefined)) return [];
  const at = placed[0]!.start;
  const source = text.slice(at, placed.at(-1)!.end);
  const urls = run.flatMap((node, i) =>
    node.type === "link" ? [{ start: placed[i]!.start - at, end: placed[i]!.end - at }] : [],
  );
  const edits: Edit[] = [];
  let from = 0;
  let next = 0;
  for (;;) {
    const match = matchFrom(source, from);
    const url = urls[next];
    if (url && (!match || url.start < match.index)) {
      from = url.end;
      next++;
      continue;
    }
    if (!match) return edits;
    if (match.kind === "link" && names(match.page)) edits.push(rewrite(match, at, to));
    from = match.index + match.length;
    while (urls[next] && urls[next].start < from) next++;
  }
}

/**
 * An alias remark made a link of, `[label]([[page]])`: its page is the last
 * `[[page]]` in its source, since the label is before it. Its label is left
 * alone, as the walk leaves it unwalked.
 */
function inAlias(text: string, node: Link, names: (page: string) => boolean, to: string): Edit[] {
  const at = span(node);
  const page = /^\[\[(.*)\]\]$/.exec(node.url)?.[1];
  if (!at || page === undefined || !names(page.trim())) return [];
  const start = text.lastIndexOf(`[[${page}]]`, at.end) + 2;
  if (start < at.start + 2) return [];
  return [{ start, end: start + page.length, with: to }];
}

/** Every edit under `node`, walked as the plugin walks it. */
function walk(text: string, node: Node, names: (page: string) => boolean, to: string): Edit[] {
  if (!("children" in node)) return [];
  const edits: Edit[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (run.length > 0) edits.push(...inRun(text, run, names, to));
    run = [];
  };
  for (const child of node.children as RootContent[]) {
    if (runs(child)) {
      run.push(child);
      continue;
    }
    flush();
    if (child.type === "link" && /^\[\[(.*)\]\]$/.test(child.url)) {
      edits.push(...inAlias(text, child, names, to));
    } else if (!(child.type === "link" && /^\(\(([^()\s]+)\)\)$/.test(child.url))) {
      edits.push(...walk(text, child, names, to));
    }
  }
  flush();
  return edits;
}

/**
 * `text` with every link to a page `names` picks naming `to` instead, in the
 * form it was written in: `[[x]]`, `#[[x]]` and `[label]([[x]])` keep their
 * shape and their label, and a bare `#x` stays bare unless `to` cannot be
 * one, when it becomes `#[[to]]`. `names` is handed each page as the walk
 * links it, trimmed. `text` itself when no link matches.
 */
export function relink(text: string, names: (page: string) => boolean, to: string): string {
  const edits = walk(text, md.parse(text) as Node, names, to).sort((a, b) => a.start - b.start);
  if (edits.length === 0) return text;
  let out = "";
  let at = 0;
  for (const edit of edits) {
    out += text.slice(at, edit.start) + edit.with;
    at = edit.end;
  }
  return out + text.slice(at);
}
