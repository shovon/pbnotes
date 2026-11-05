/**
 * Copied blocks as HTML (#261), for an app that pastes rich text: a nested
 * list, each block's Markdown rendered by the parser the blocks show with,
 * and the blocks themselves riding on the list for a paste into pbnotes
 * (`clip/`).
 *
 * Rendered for somewhere else, so nothing in it points back into the app: a
 * page link reads as it was typed and goes nowhere, a ref reads what it
 * shows (`unreferenced`), and a project image is carried as data. Math is
 * left as its source, since the app it lands in has no KaTeX to draw it.
 *
 * Pure, given what each image is as data, and free of JSX, so it runs under
 * `node --test`.
 */
import { createElement, Fragment } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { remarkPlugins as reading } from '@pbnotes/graph';
import type { Block } from '@pbnotes/graph';
import { remarkHighlight, remarkStrikethrough } from '../../../Block/marks/marks.ts';
import { ATTRIBUTE, encode, IMAGE_ATTRIBUTE } from '../../clip/clip.ts';
import { copied, localImage, unreferenced } from '../copy.ts';
import type { Previews } from '../copy.ts';

/** Read the way a block is read on screen, marks and all. */
const remarkPlugins = [...reading, remarkStrikethrough, remarkHighlight];

/**
 * `blocks` as one HTML list. `images` is each project image's name and what
 * it is as a `data:` URL, tagged with its name so a paste into pbnotes can
 * store it; one not in it is left out, as it would show nothing anywhere
 * else. `source` is the token for where images too big to carry are.
 */
export function asHtml(
  blocks: readonly Block[],
  previews: Previews,
  images: ReadonlyMap<string, string>,
  source?: string,
): string {
  const components = {
    // A page link reads as it was typed, and goes nowhere: its fragment
    // means something only in this app.
    a: ({ className, href, children }: { className?: string; href?: string; children?: ReactNode }) =>
      className === 'wikilink' || !href
        ? createElement(Fragment, null, children)
        : createElement('a', { href }, children),
    // Every ref was swapped for its words already; one left is shown as words.
    'block-ref': ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
    img: ({ src, alt, title }: { src?: string; alt?: string; title?: string }) => {
      const name = localImage(src ?? '');
      if (name === undefined) return src ? createElement('img', { src, alt, title }) : null;
      const data = images.get(name);
      return data ? createElement('img', { src: data, alt, title, [IMAGE_ATTRIBUTE]: name }) : null;
    },
  } as Components;

  const item = (block: Block): ReactNode =>
    createElement(
      'li',
      { key: block.id },
      createElement(Markdown, { remarkPlugins, components }, unreferenced(block.text, previews)),
      block.children.length > 0 ? createElement('ul', null, block.children.map(item)) : null,
    );

  // React puts a preload ahead of a page's images, which a clipboard has no
  // use for: the list is the whole copy.
  return renderToStaticMarkup(
    createElement('ul', { [ATTRIBUTE]: encode(copied(blocks), source) }, blocks.map(item)),
  ).replace(/^(<link [^>]*>)+/, '');
}
