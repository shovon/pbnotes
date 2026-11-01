/**
 * What the finder lists for an answer, and what picking a row opens.
 *
 * Pure, so the rules run under `node --test`; `Finder` holds the state.
 */

/** A block that matched: its id, the page it is on, and its text as shown. */
export type FoundBlock = { id: string; page: string; text: string };

/** What a search answers with: titles first, then blocks. */
export type Found = { pages: readonly string[]; blocks: readonly FoundBlock[] };

/** What picking a row opens: a page, or the block's page scrolled to it. */
export type Hit = { page: string } | { block: string };

export type Row = { kind: 'page'; title: string } | ({ kind: 'block' } & FoundBlock);

export const nothing: Found = { pages: [], blocks: [] };

/** One list, in the order it is drawn and walked: pages, then blocks. */
export function rows(found: Found): Row[] {
  return [
    ...found.pages.map((title): Row => ({ kind: 'page', title })),
    ...found.blocks.map((block): Row => ({ kind: 'block', ...block })),
  ];
}

export function hitOf(row: Row): Hit {
  return row.kind === 'page' ? { page: row.title } : { block: row.id };
}

/** Up and Down through `count` rows, wrapping at either end. */
export function step(active: number, by: number, count: number): number {
  return count === 0 ? 0 : (((active + by) % count) + count) % count;
}

/**
 * `text` cut where it contains `query`, ignoring case, so the matches can be
 * drawn bold. Left whole when lowering the case changes the text's length:
 * an index into the lowered text would then point at the wrong letters.
 */
export function marked(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  if (!q || lower.length !== text.length) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + q.length), match: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
