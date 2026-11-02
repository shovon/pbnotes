/**
 * What a block's text says once it is read as markdown: the pages it links
 * to, the blocks it refers to, and what a ref to it shows.
 *
 * Text in, data out. Nothing here knows a block, a page, a ledger or a view.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkPlugins } from "../wikilink/wikilink.ts";

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
  /** What it says with the markdown taken off; see `plain`. */
  plain: string;
};

const readings = new Map<string, Reading>();

type Node = {
  type: string;
  value?: string;
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

/** Nodes whose children are blocks of their own, so their words are kept apart. */
const BLOCKS = new Set(["root", "list", "listItem", "blockquote", "table", "tableRow"]);

/**
 * What a text says, as words: code and math as written, a link by its label,
 * and a wikilink's label without the `[[ ]]` it shows with, so a search for
 * `Mira` finds `[[Mira]]` and one for `[[` finds nothing. A ref with no label
 * says nothing: the words it shows are another block's. One line, so it can
 * be shown as one.
 *
 * Taken after the plugins run, so links are the nodes the renderer draws.
 */
function plain(root: Node): string {
  const words = (node: Node): string => {
    if (node.value !== undefined) return node.value;
    if (node.type === "break") return " ";
    const inner = (node.children ?? []).map(words).join(BLOCKS.has(node.type) ? " " : "");
    return node.type === "wikilink" ? inner.replace(/^\[\[|\]\]$/g, "") : inner;
  };
  return words(root).replace(/\s+/g, " ").trim();
}

export function read(text: string): Reading {
  const memo = readings.get(text);
  if (memo) return memo;
  const root = md.parse(text);
  const reading: Reading = {
    links: [],
    refs: [],
    preview: preview(text, root as Node),
    plain: "",
  };
  const walk = (node: Node): void => {
    const { href, dataBlockRef } = node.data?.hProperties ?? {};
    if (node.type === "wikilink" && href) reading.links.push(href.slice(1));
    if (node.type === "blockRef" && dataBlockRef) {
      reading.refs.push(dataBlockRef);
    }
    node.children?.forEach(walk);
  };
  const tree = md.runSync(root) as Node;
  walk(tree);
  reading.plain = plain(tree);
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
