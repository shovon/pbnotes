/**
 * Blocks pasted from a pbnotes copy (#261): named afresh, and placed. Pure,
 * told how to make an id, so it runs under `node --test`; the views read
 * the clipboard and ask main to write.
 */
import { spans } from '@pbnotes/graph';
import type { Block } from '@pbnotes/graph';
import type { GraphApi, Pasted } from '../../../../shared/graph';
import { bytesOf, carried } from '../clip/clip.ts';
import type { Clipped, Copied } from '../clip/clip';
import { localImage } from '../copy/copy.ts';

/** Where the first pasted block goes, as `pasteBlocks` takes it. */
export type Spot = { after?: string; parent?: string } | { into: string };

/** `blocks` with a new id each, from `newId`, nested as they were. */
export function withIds(blocks: readonly Copied[], newId: () => string): Pasted[] {
  return blocks.map((block) => ({
    id: newId(),
    text: block.text,
    children: withIds(block.children, newId),
  }));
}

/**
 * The end of what is in view: last under the zoomed `root`, after its last
 * child or as its first, or with no zoom the end of the page.
 */
export function endOf(root: Block | undefined): Spot {
  if (!root) return {};
  const last = root.children.at(-1);
  return last ? { after: last.id, parent: root.id } : { parent: root.id };
}

/**
 * Beneath block `id`, at its depth, its subtree before the paste. The zoomed
 * `root` is the exception: beneath it is out of view, so the paste goes at
 * the end of what is in view instead.
 */
export function beneath(id: string, root: Block | undefined): Spot {
  return root?.id === id ? endOf(root) : { after: id };
}

/** The project images `blocks` link in their own text, each once. */
export function linkedImages(blocks: readonly Copied[]): string[] {
  const names = new Set<string>();
  const visit = (block: Copied) => {
    for (const span of spans(block.text)) {
      const name = span.kind === 'image' ? localImage(span.url) : undefined;
      if (name) names.add(name);
    }
    block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return [...names];
}

/** `blocks` with each image link `renames` names pointed at its new name. */
export function relinked(blocks: readonly Copied[], renames: ReadonlyMap<string, string>): Copied[] {
  if (renames.size === 0) return [...blocks];
  return blocks.map((block) => {
    let text = '';
    let at = 0;
    for (const span of spans(block.text)) {
      const to = span.kind === 'image' ? renames.get(localImage(span.url) ?? '') : undefined;
      if (to === undefined || span.kind !== 'image') continue;
      const source = block.text.slice(span.start, span.end);
      text += block.text.slice(at, span.start) + source.replace(`images/${localImage(span.url)}`, `images/${to}`);
      at = span.end;
    }
    return { text: text + block.text.slice(at), children: relinked(block.children, renames) };
  });
}

/**
 * The blocks of a pbnotes paste, once the images they link are in this
 * project (#261): each is brought by main, from the bytes `html` carries or
 * from where `clipped.source` says, and one that landed under another name
 * is linked by that one. One that could not be had keeps its link, broken.
 */
export async function landed(
  graph: Pick<GraphApi, 'carryImages'>,
  clipped: Clipped,
  html: string,
): Promise<Copied[]> {
  const names = linkedImages(clipped.blocks);
  if (names.length === 0) return clipped.blocks;
  const data = carried(html);
  const links = await graph.carryImages(
    names.map((name) => {
      const image = data.get(name);
      const it = image === undefined ? undefined : bytesOf(image);
      return it ? { name, ...it } : { name };
    }),
    clipped.source,
  );
  const renames = new Map<string, string>();
  names.forEach((name, at) => {
    const to = localImage(links[at] ?? '');
    if (to !== undefined && to !== name) renames.set(name, to);
  });
  return relinked(clipped.blocks, renames);
}
