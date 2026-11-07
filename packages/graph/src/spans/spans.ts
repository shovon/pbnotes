/**
 * Where in a block's source its block refs and images are (#261), for
 * whatever writes the text out somewhere a ref's id means nothing: a copy to
 * another app, which swaps a ref for what it shows and leaves an image out.
 *
 * Read with the same parser that renders the text, so a `((x))` in code or
 * math is text here too. Text in, offsets out: nothing here knows a block.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import { refsIn, remarkPlugins } from "../wikilink/wikilink.ts";

/** A ref or an image, and the source it is: `text.slice(start, end)`. */
export type Span = { start: number; end: number } & (
  | {
      kind: "ref";
      id: string;
      /** The source of `[label](((id)))`'s label; absent for a bare `((id))`. */
      label?: string;
    }
  | { kind: "image"; url: string }
);

type Node = {
  type: string;
  url?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Node[];
};

/** Parsed only: the plugins' walk drops the positions this reads. */
const md = unified().use(remarkParse).use(remarkPlugins);

const REF = /^\(\(([^()\s]+)\)\)$/;

/** Every ref and image in `text`, in the order they are written. */
export function spans(text: string): Span[] {
  const out: Span[] = [];
  const visit = (node: Node): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "image") {
      out.push({ kind: "image", url: node.url ?? "", start, end });
      return;
    }
    if (node.type === "text") {
      for (const ref of refsIn(text.slice(start, end))) {
        const at = start + ref.index;
        out.push({ kind: "ref", id: ref.id, start: at, end: at + ref.length });
      }
      return;
    }
    if (node.type === "link") {
      const ref = REF.exec(node.url ?? "");
      if (ref) {
        const inner = node.children ?? [];
        const from = inner[0]?.position?.start.offset;
        const to = inner.at(-1)?.position?.end.offset;
        const label = from === undefined || to === undefined ? "" : text.slice(from, to);
        out.push({ kind: "ref", id: ref[1], label, start, end });
        return;
      }
      // A page alias's label is not walked, and a bare URL swallows what is
      // in it: the walk the renderer reads with finds no ref in either.
      if (/^\[\[.*\]\]$/.test(node.url ?? "") || bareUrl(node, text)) return;
    }
    node.children?.forEach(visit);
  };
  visit(md.parse(text) as Node);
  return out;
}

/** A link written as its own URL, which is how GFM reads a bare one. */
function bareUrl(node: Node, text: string): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return false;
  return !text.slice(start, end).startsWith("[") && !text.slice(start, end).startsWith("<");
}
