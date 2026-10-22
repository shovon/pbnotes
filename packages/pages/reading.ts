/**
 * What a block's text says once it is read as markdown: the pages it links
 * to, the blocks it refers to, and what a ref to it shows.
 *
 * Text in, data out. Nothing here knows a project, a ledger or a view —
 * `pages.ts` fetches the fold and asks these about the blocks in it.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import { pageKey } from "./blocks.ts";
import type { Block } from "./blocks.ts";
import { remarkPlugins } from "./wikilink.ts";

/**
 * The pages a text links to and the blocks it refers to, read with the same parser that renders it, so
 * a `#foo` in a code span is text on both sides.
 *
 * Memoised on the text, not the block: identical text links identically,
 * and the fold hands every block an event did not touch back with the text
 * it had — so a write parses the one text that changed, and a refold, which
 * rebuilds every block object from the log every half minute, parses
 * nothing it has seen. Keyed on the object, the whole project would be
 * parsed again after each of those.
 *
 * ponytail: the map keeps every text ever parsed this session, edits
 * included. Strings the log already holds, so it is small; bound it if a
 * long session ever shows it.
 *
 * Read from the `href` the plugin sets, which is the contract the renderer
 * follows a link by; a link to nothing has no `href` and is not a link.
 */
const md = unified().use(remarkParse).use(remarkPlugins);

/** What one parse of a block's text has to say, for everything that asks. */
type Reading = {
  /** The pages it links to. */
  links: string[];
  /** The blocks it refers to, by id. */
  refs: string[];
  /** What a ref to it shows; see `preview`. */
  preview: string;
};

const readings = new Map<string, Reading>();

type Node = {
  type: string;
  data?: { hProperties?: { href?: string; dataBlockRef?: string } };
  position?: { start: { offset: number }; end: { offset: number } };
  children?: Node[];
};

/**
 * What a ref to a block shows: the source of its first paragraph, cut out
 * of the text rather than rebuilt from the tree, so the view renders it with
 * the bold, code and links it was written with. A heading counts — it is a
 * line of prose with a sigil in front, and the cut leaves the sigil behind.
 *
 * Empty for a block that starts with anything else, and the ref shows the id.
 * ponytail: a list or a code block could show its text flattened instead;
 * `mdast-util-to-string` does it, as a dependency of our own, if ids for
 * those turn out to be common.
 *
 * Taken before the plugins run: they replace text nodes with ones that carry
 * no position.
 */
function preview(text: string, root: Node): string {
  const first = root.children?.[0];
  const inline = first?.children ?? [];
  const from = inline[0]?.position?.start.offset;
  const to = inline.at(-1)?.position?.end.offset;
  if (first?.type !== "paragraph" && first?.type !== "heading") return "";
  return from === undefined || to === undefined ? "" : text.slice(from, to);
}

export function read(text: string): Reading {
  const memo = readings.get(text);
  if (memo) return memo;
  const root = md.parse(text);
  const reading: Reading = {
    links: [],
    refs: [],
    preview: preview(text, root as Node),
  };
  const walk = (node: Node): void => {
    const { href, dataBlockRef } = node.data?.hProperties ?? {};
    if (node.type === "wikilink" && href) reading.links.push(href.slice(1));
    if (node.type === "blockRef" && dataBlockRef) {
      reading.refs.push(dataBlockRef);
    }
    node.children?.forEach(walk);
  };
  walk(md.runSync(root) as Node);
  readings.set(text, reading);
  return reading;
}

/**
 * Whether `offset` in `text` falls inside code or math, where nothing becomes
 * a link. Asked by the editor before it offers to complete one, through the
 * same parse the renderer reads with, so the two cannot disagree about where
 * code starts. An unclosed fence runs to the end, as it renders.
 */
export function inCode(text: string, offset: number): boolean {
  const inside = (node: Node): boolean =>
    ["code", "inlineCode", "math", "inlineMath"].includes(node.type)
      ? node.position!.start.offset <= offset &&
        offset < node.position!.end.offset
      : (node.children ?? []).some(inside);
  return inside(md.parse(text) as Node);
}

/**
 * The blocks that link to `title`, in whatever case the link was written,
 * each with its subtree intact. A block that links is taken whole and not
 * searched inside: its children are already on show under it, and listing
 * one of them again for a link of its own would put the same words on the
 * page twice.
 */
export function linking(blocks: Block[], title: string): Block[] {
  const key = pageKey(title);
  return blocks.flatMap((block) =>
    read(block.text).links.some((link) => pageKey(link) === key)
      ? [block]
      : linking(block.children, title),
  );
}
