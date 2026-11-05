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
export function encode(blocks: readonly Copied[]): string {
  const json = JSON.stringify({ v: V, blocks });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The blocks a paste's HTML carries, or undefined when it carries none it can read. */
export function decode(html: string): Copied[] | undefined {
  const value = new RegExp(`${ATTRIBUTE}="([A-Za-z0-9+/=]*)"`).exec(html)?.[1];
  if (value === undefined) return undefined;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const read: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof read !== 'object' || read === null) return undefined;
    const { v, blocks } = read as Record<string, unknown>;
    if (v !== V) return undefined;
    const checked = blocksOf(blocks);
    return checked && checked.length > 0 ? checked : undefined;
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
