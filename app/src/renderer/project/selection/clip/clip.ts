/**
 * Blocks as they travel on the clipboard between two pbnotes windows (#261):
 * written into a copy's HTML, as an attribute on its list, and read back out
 * of a paste's. In the HTML rather than a format of its own, because a paste
 * has to decide at once whether it is a paste of blocks, and the standard
 * formats are the ones that can be read at that moment.
 *
 * What is read back came off a clipboard any app can write, so it is checked
 * the way main checks a command, and anything that does not hold up is not
 * blocks at all: the paste is then the text it also carries.
 *
 * Pure, and free of the DOM, so it runs under `node --test`.
 */

/** A copied block: its text, and what hangs under it. No id: a paste names its own. */
export type Copied = { text: string; children: Copied[] };

/** The attribute the blocks ride in. */
export const ATTRIBUTE = 'data-pbnotes';

/** The attribute that names a project image carried in a copy's HTML as data. */
export const IMAGE_ATTRIBUTE = 'data-pbnotes-image';

/**
 * What a paste of blocks reads: the blocks, and, when the copy had images
 * too big to carry, the token main handed out for where they are.
 */
export type Clipped = { blocks: Copied[]; source?: string };

/**
 * The version of what the attribute holds. One a build does not know is
 * not read, and the paste is the text: a newer build's blocks are never
 * half-understood.
 */
const V = 1;

/** As many blocks as main takes in one paste, and as deep (`command.ts`). */
const LIMITS = { blocks: 10_000, depth: 100 };

/**
 * `blocks` as the attribute's value: JSON, then base64 over its UTF-8, so
 * nothing in a note's text can break out of the attribute or be changed by
 * an app that rewrites HTML entities on the way through.
 */
export function encode(blocks: readonly Copied[], source?: string): string {
  const json = JSON.stringify({ v: V, blocks, ...(source === undefined ? {} : { source }) });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The blocks a paste's HTML carries, or undefined when it carries none it can read. */
export function decode(html: string): Clipped | undefined {
  const value = new RegExp(`${ATTRIBUTE}="([A-Za-z0-9+/=]*)"`).exec(html)?.[1];
  if (value === undefined) return undefined;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const read: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof read !== 'object' || read === null) return undefined;
    const { v, blocks, source } = read as Record<string, unknown>;
    if (v !== V) return undefined;
    const checked = blocksOf(blocks);
    if (!checked || checked.length === 0) return undefined;
    // A token is main's to judge; here it only has to be a token's size.
    const token = typeof source === 'string' && source.length <= 64 ? { source } : {};
    return { blocks: checked, ...token };
  } catch {
    return undefined;
  }
}

/** `raw` as copied blocks, built fresh from the two fields each reads, or undefined. */
function blocksOf(raw: unknown): Copied[] | undefined {
  let count = 0;
  const read = (it: unknown, depth: number): Copied[] | undefined => {
    if (!Array.isArray(it) || depth > LIMITS.depth) return undefined;
    const out: Copied[] = [];
    for (const block of it) {
      count += 1;
      if (count > LIMITS.blocks || typeof block !== 'object' || block === null) return undefined;
      const text = Object.hasOwn(block, 'text') ? (block as { text: unknown }).text : undefined;
      const under = Object.hasOwn(block, 'children')
        ? read((block as { children: unknown }).children, depth + 1)
        : undefined;
      if (typeof text !== 'string' || !under) return undefined;
      out.push({ text, children: under });
    }
    return out;
  };
  return read(raw, 1);
}

/** A name as `images/<name>` links it: a bare file name, nothing that reaches out of the folder. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The project images a copy's HTML carries as data, by name: each `img`
 * tagged with `IMAGE_ATTRIBUTE` and a `data:` source. An image tagged with a
 * name that is not a bare file name, or twice, keeps the first.
 */
export function carried(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const name = new RegExp(`${IMAGE_ATTRIBUTE}="([^"]*)"`).exec(tag)?.[1];
    const src = /\ssrc="(data:[^"]*)"/.exec(tag)?.[1];
    if (name && src && NAME.test(name) && !out.has(name)) out.set(name, src);
  }
  return out;
}

/** The bytes and type of a base64 `data:` URL, or undefined for anything else. */
export function bytesOf(url: string): { bytes: Uint8Array; mime: string } | undefined {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]*)$/i.exec(url);
  if (!match) return undefined;
  try {
    return { mime: match[1].toLowerCase(), bytes: Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)) };
  } catch {
    return undefined;
  }
}
