/**
 * One Logseq Markdown file, as an outline: its page properties and its tree
 * of blocks. Text in, data out, no I/O.
 *
 * A line whose text starts with `- `, or is a bare `-`, starts a block,
 * unless it is inside a code fence. Lines after it that start no block
 * continue it. A block's parent is the nearest block above it with less
 * indentation, a tab and a space each counting as one character: Logseq
 * writes `\t - ` and `\t\t- ` side by side, so a fixed width per level is
 * wrong.
 *
 * Consumed from a block, and nothing else: an `id::` line among its leading
 * property lines (it becomes the block's id), a `collapsed::` line among
 * them, and `:LOGBOOK:` … `:END:` drawers. Everything else stays in the text.
 */

/** A block: its text, the `id::` it carried if any, and the blocks under it. */
export type Tree = { text: string; id?: string; children: Tree[] };

export type Parsed = {
  /** The pre-block's `key:: value` lines, in order, key as written, value trimmed. */
  properties: [string, string][];
  blocks: Tree[];
  /** How many `:LOGBOOK:` drawers were dropped. */
  logbooks: number;
};

const PROPERTY = /^([A-Za-z0-9_][\w\-.\/?!]*)::(?:[ \t]+(.*))?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A `key:: value` line as `[key, value]`, or undefined. */
export function property(line: string): [string, string] | undefined {
  const found = PROPERTY.exec(line.trim());
  return found ? [found[1], (found[2] ?? "").trim()] : undefined;
}

const indentOf = (line: string) => line.length - line.replace(/^[ \t]+/, "").length;

/** `line` with at most `width` characters of leading space or tab removed. */
function dedent(line: string, width: number): string {
  let at = 0;
  while (at < width && (line[at] === " " || line[at] === "\t")) at++;
  return line.slice(at);
}

/** Tracks whether a line is inside a fenced code block. */
function fences() {
  let open: string | undefined;
  return {
    get inside() {
      return open !== undefined;
    },
    /** Feeds one line of content, its indentation already gone. */
    see(content: string) {
      const line = content.trim();
      if (open === undefined) {
        const found = /^(`{3,}|~{3,})(.*)$/.exec(line);
        // A backtick fence's info string has no backtick: ```a``` is code in a line.
        if (found && !(found[1][0] === "`" && found[2].includes("`"))) open = found[1];
      } else if (line.startsWith(open) && /^(`+|~+)$/.test(line) && line[0] === open[0]) {
        open = undefined;
      }
    },
  };
}

type Raw = { indent: number; lines: string[] };

const blank = (line: string) => line.trim() === "";

function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && blank(lines[start])) start++;
  while (end > start && blank(lines[end - 1])) end--;
  return lines.slice(start, end);
}

/** The text and id of one block, from its lines, and how many drawers went. */
function consume(lines: string[]): { text: string; id?: string; logbooks: number } {
  const kept = [...lines];
  let id: string | undefined;
  // The leading property lines: any before the block's first line of text,
  // and those right after it. Returns where the run stopped.
  const run = (from: number): number => {
    let at = from;
    while (at < kept.length) {
      const it = property(kept[at]);
      if (!it) break;
      const key = it[0].toLowerCase();
      if (key === "id" && id === undefined && UUID.test(it[1])) {
        id = it[1];
        kept.splice(at, 1);
      } else if (key === "collapsed") kept.splice(at, 1);
      else at++;
    }
    return at;
  };
  run(run(0) + 1);
  let logbooks = 0;
  for (;;) {
    const start = kept.findIndex((line) => line.trim() === ":LOGBOOK:");
    const end = start === -1 ? -1 : kept.findIndex((line, i) => i > start && line.trim() === ":END:");
    // An unclosed drawer is left as text: dropping to the end could lose writing.
    if (end === -1) break;
    kept.splice(start, end - start + 1);
    logbooks++;
  }
  const text = trimBlankEnds(kept).join("\n");
  return { text, ...(id ? { id } : {}), logbooks };
}

/** The pre-block's properties, and its other text as a block's lines. */
function preBlock(lines: string[]): { properties: [string, string][]; rest: string[] } {
  const properties: [string, string][] = [];
  let at = 0;
  for (; at < lines.length; at++) {
    if (blank(lines[at])) continue;
    const it = property(lines[at]);
    if (!it) break;
    properties.push(it);
  }
  return { properties, rest: trimBlankEnds(lines.slice(at)) };
}

export function parse(text: string): Parsed {
  const lines = text.split(/\r?\n/);
  const pre: string[] = [];
  const raws: Raw[] = [];
  const fence = fences();
  for (const line of lines) {
    const trimmed = line.trimStart();
    const starts = !fence.inside && (trimmed.startsWith("- ") || trimmed.trimEnd() === "-");
    if (starts) {
      const indent = indentOf(line);
      const content = trimmed.trimEnd() === "-" ? "" : trimmed.slice(2);
      raws.push({ indent, lines: [content] });
      fence.see(content);
      continue;
    }
    const current = raws.at(-1);
    if (!current) {
      pre.push(line);
      fence.see(line);
      continue;
    }
    // The block's content starts two characters past its dash.
    const content = dedent(line, current.indent + 2);
    current.lines.push(content);
    fence.see(content);
  }

  const { properties, rest } = preBlock(pre);
  const blocks: Tree[] = [];
  let logbooks = 0;
  if (rest.length > 0) {
    const first = consume(rest);
    logbooks += first.logbooks;
    if (first.text !== "" || first.id) blocks.push({ text: first.text, ...(first.id ? { id: first.id } : {}), children: [] });
  }
  const stack: { indent: number; tree: Tree }[] = [];
  for (const raw of raws) {
    const { text: body, id, logbooks: dropped } = consume(raw.lines);
    logbooks += dropped;
    const tree: Tree = { text: body, ...(id ? { id } : {}), children: [] };
    while (stack.length > 0 && stack.at(-1)!.indent >= raw.indent) stack.pop();
    (stack.at(-1)?.tree.children ?? blocks).push(tree);
    stack.push({ indent: raw.indent, tree });
  }
  return { properties, blocks, logbooks };
}
