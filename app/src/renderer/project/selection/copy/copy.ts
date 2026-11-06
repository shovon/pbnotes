/**
 * Selected blocks, made into what a copy puts on the clipboard (#261). Pure,
 * over blocks as the view holds them and what each `((id))` shows, so it
 * runs under `node --test`; the view reads the screen and main writes the
 * clipboard.
 *
 * Every block copies with its whole subtree, and once: a selection hands on
 * its top-most blocks (`roots`), and those are checked here against the
 * trees they come from, since a cut shows a block without its parent.
 */
import { spans } from '@pbnotes/graph';
import type { Block } from '@pbnotes/graph';
import type { Copied } from '../clip/clip';

/** Block id → what a `((id))` shows, as main answers it: null for a block that is gone. */
export type Previews = ReadonlyMap<string, string | null>;

/**
 * The blocks `ids` name, each with its subtree, in the order given, read
 * out of `trees`: every list of blocks on screen, pages and cuts alike. A
 * block that another of them holds is left out, it is copied with that one;
 * so is an id named twice, or one no tree has.
 */
export function picked(trees: readonly (readonly Block[])[], ids: readonly string[]): Block[] {
  const byId = new Map<string, Block>();
  const index = (blocks: readonly Block[]) => {
    for (const block of blocks) {
      if (!byId.has(block.id)) byId.set(block.id, block);
      index(block.children);
    }
  };
  trees.forEach(index);
  const found = [...new Set(ids)].flatMap((id): Block[] => {
    const it = byId.get(id);
    return it ? [it] : [];
  });
  const inside = new Set(found.flatMap((block) => block.children.flatMap(every)));
  return found.filter((block) => !inside.has(block.id));
}

/** Every id in `block`'s subtree, its own included. */
function every(block: Block): string[] {
  return [block.id, ...block.children.flatMap(every)];
}

/**
 * `blocks` as they travel: their text and their nesting, and with `ids`
 * (a cut, #246) each block's id. A copy carries none.
 */
export function copied(blocks: readonly Block[], ids = false): Copied[] {
  return blocks.map((block) => ({
    text: block.text,
    children: copied(block.children, ids),
    ...(ids ? { id: block.id } : {}),
  }));
}

/** How deep a ref is followed into the block it shows, and that block's refs into theirs. */
const DEPTH = 3;

/**
 * `text` with its refs swapped for what they show, for somewhere an id means
 * nothing: `[label](((id)))` reads `label`, and a bare `((id))` the first
 * paragraph of its block, its own refs swapped in turn. A ref to a block
 * that is gone, that has no paragraph to show, or that leads back to one
 * already being shown, is dropped. With `images` false, every image is
 * dropped too.
 */
export function unreferenced(
  text: string,
  previews: Previews,
  { images = true }: { images?: boolean } = {},
  seen: readonly string[] = [],
): string {
  let out = '';
  let at = 0;
  for (const span of spans(text)) {
    out += text.slice(at, span.start);
    at = span.end;
    if (span.kind === 'image') {
      if (images) out += text.slice(span.start, span.end);
    } else if (span.label !== undefined) {
      out += span.label;
    } else {
      const preview = previews.get(span.id);
      if (preview && !seen.includes(span.id) && seen.length < DEPTH) {
        out += unreferenced(preview, previews, { images }, [...seen, span.id]);
      }
    }
  }
  return out + text.slice(at);
}

/**
 * `blocks` as an indented Markdown list matching their nesting, refs swapped
 * for what they show and images left out. Two spaces a level, which is
 * where CommonMark puts a nested item after `- `. A block over several
 * lines keeps them, each indented to its item's text, so they stay part of
 * it; a run of blank lines left by what was taken out closes up to one.
 */
export function asText(blocks: readonly Block[], previews: Previews): string {
  const lines = (block: Block, indent: string): string[] => {
    const text = unreferenced(block.text, previews, { images: false })
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const [first = '', ...rest] = text.split('\n');
    return [
      `${indent}- ${first}`.trimEnd(),
      ...rest.map((line) => `${indent}  ${line}`.trimEnd()),
      ...block.children.flatMap((child) => lines(child, `${indent}  `)),
    ];
  };
  return blocks.flatMap((block) => lines(block, '')).join('\n');
}

/**
 * The names of the project's own images `blocks` show, `images/<name>`, each
 * once: what a copy has to carry for another app to show them. An image on
 * the web is left to the web.
 */
export function imageNames(blocks: readonly Block[], previews: Previews): string[] {
  const names = new Set<string>();
  const visit = (block: Block) => {
    for (const span of spans(unreferenced(block.text, previews))) {
      const name = span.kind === 'image' ? localImage(span.url) : undefined;
      if (name) names.add(name);
    }
    block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return [...names];
}

/** The name of a project image a note links as `images/<name>`, or undefined. */
export function localImage(url: string): string | undefined {
  return /^images\/([^/]+)$/.exec(url)?.[1];
}

/** An image's bytes as a `data:` URL, which carries it inside HTML. */
export function dataUrl({ bytes, mime }: { bytes: Uint8Array; mime: string }): string {
  let binary = '';
  // In runs, not a byte at a time: a photo is megabytes.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
