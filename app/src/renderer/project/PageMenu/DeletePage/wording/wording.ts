/**
 * What the delete confirmation says: what goes, and what a delete leaves
 * pointing at the page from elsewhere, one line per case that applies.
 *
 * Pure, so the wording runs under `node --test`; `DeletePage` draws it.
 */
import type { DeleteImpact } from '@pbnotes/pages';

/** `n` blocks, said the way a sentence needs it. */
const blocks = (n: number) => (n === 1 ? '1 block on another page' : `${n} blocks on other pages`);

export function wording(title: string, impact: DeleteImpact): string[] {
  const lines = [
    impact.links > 0
      ? `${blocks(impact.links)} ${impact.links === 1 ? 'links' : 'link'} to “${title}”. Its blocks and properties will be deleted, but “${title}” will still exist and show up in search until those links are removed.`
      : `“${title}” and everything on it will be deleted.`,
  ];
  if (impact.refs > 0) {
    lines.push(
      `${blocks(impact.refs)} ${impact.refs === 1 ? 'references' : 'reference'} blocks on “${title}”. Those references will show as missing.`,
    );
  }
  return lines;
}
