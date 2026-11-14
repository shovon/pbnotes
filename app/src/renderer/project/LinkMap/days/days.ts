/**
 * The link map with the journal left out: no day's page, and no arrow that
 * starts or ends on one. What the view's "Journal days" toggle shows when it
 * is off. Pure.
 */
import { DATE_PATTERN } from '@pbnotes/graph';
import type { LinkMap } from '@pbnotes/graph/link-map';

export function withoutDays<T extends LinkMap>(map: T): T {
  const day = (title: string) => DATE_PATTERN.test(title);
  return {
    ...map,
    pages: map.pages.filter((page) => !day(page.title)),
    edges: map.edges.filter((edge) => !day(edge.from.page) && !day(edge.to.page)),
  };
}
