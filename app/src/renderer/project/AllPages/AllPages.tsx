import { useEffect, useMemo, useState } from 'react';
import type { PageListing } from '@pbnotes/graph';
import { FileText } from 'lucide-react';
import PageIcon from '../PageIcon/PageIcon';
import type { GraphApi } from '../../../shared/graph';
import { sorted, toggle } from './sort/sort';
import type { Column, Sort } from './sort/sort';
import type { Keys } from '../opening/opening';

/**
 * Every page in the project, as a table (#200): its title, after its icon
 * (#329, `file-text` for a page with none, as the sidebar has it), how many blocks are
 * on it, how many blocks link to it, and when it last changed. A header
 * sorts by its column; a title opens the page the way a link does.
 *
 * Asks main for the list when it mounts and again each time the fold moves,
 * keeping the answer read at the highest version, so one that arrives late
 * never draws over a newer one.
 */
type Props = {
  /** The part of the bridge this calls. */
  graph: Pick<GraphApi, 'pages' | 'onChanged'>;
  /** Held by `ProjectView`, so back to the list finds it sorted as it was left. */
  sort: Sort;
  onSort: (sort: Sort) => void;
  /**
   * A page was clicked, with the keys held, which say where it opens: here,
   * beside (#287) or in a new tab (#309, `opening/`).
   */
  onOpen: (page: string, keys: Keys) => void;
  /** A list that could not be read. */
  onError: (error: unknown) => void;
};

const COLUMNS: { by: Column; name: string; numeric: boolean }[] = [
  { by: 'title', name: 'Page', numeric: false },
  { by: 'blocks', name: 'Blocks', numeric: true },
  { by: 'references', name: 'References', numeric: true },
  // Pages that tag it: never added to References, which stays links only.
  { by: 'taggedBy', name: 'Tagged by', numeric: true },
  { by: 'edited', name: 'Last edited', numeric: true },
];

/** Where the sort arrow goes: room for it always, so a click moves nothing. */
const arrow = (active: boolean, descending: boolean, side: string) => (
  <span aria-hidden className={`${side} inline-block w-2`}>
    {active ? (descending ? '↓' : '↑') : ''}
  </span>
);

/** In the viewer's own locale and time zone. */
const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function AllPages({ graph, sort, onSort, onOpen, onError }: Props) {
  const [held, setHeld] = useState<{ version: number; pages: PageListing[] } | null>(null);

  useEffect(() => {
    let live = true;
    const ask = () =>
      graph.pages().then(
        (answer) => {
          if (!live) return;
          setHeld((current) => (current && current.version > answer.version ? current : answer));
        },
        (error) => live && onError(error),
      );
    void ask();
    const off = graph.onChanged(() => void ask());
    return () => {
      live = false;
      // A stubbed bridge — Storybook's — may answer with no unsubscribe.
      if (typeof off === 'function') off();
    };
  }, [graph]);

  const rows = useMemo(() => (held ? sorted(held.pages, sort) : []), [held, sort]);

  return (
    <section aria-labelledby="all-pages-title">
      <h2
        id="all-pages-title"
        className="mt-6 mb-4 text-2xl font-semibold"
      >
        All pages
      </h2>
      {held === null ? (
        <p className="mt-1 text-sm text-muted">Loading…</p>
      ) : held.pages.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No pages yet. Write in the journal, or link to a page, and it shows up here.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              {COLUMNS.map(({ by, name, numeric }) => {
                const active = sort.by === by;
                return (
                  <th
                    key={by}
                    scope="col"
                    aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                    className={`py-1.5 font-medium whitespace-nowrap ${numeric ? 'pl-4 text-right' : 'text-left'}`}
                  >
                    <button
                      type="button"
                      className={`cursor-pointer hover:text-accent ${active ? 'text-fg' : ''}`}
                      onClick={() => onSort(toggle(sort, by))}
                    >
                      {/* On the side away from the column's edge, so the
                          name lines up with what is under it. */}
                      {numeric && arrow(active, sort.descending, 'mr-1')}
                      {name}
                      {!numeric && arrow(active, sort.descending, 'ml-1')}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((page) => (
              <tr key={page.title} className="border-b border-line last:border-b-0">
                {/* The rest of the width, and no more: `max-w-0` lets a long title truncate. */}
                <td className="w-full max-w-0 py-1.5">
                  <button
                    type="button"
                    // Truncated to one line; the whole title on hover.
                    title={page.title}
                    className={`group flex max-w-full cursor-pointer items-center gap-2 text-left ${
                      page.blocks === 0 ? 'text-muted' : 'text-accent'
                    }`}
                    onClick={(event) => onOpen(page.title, event)}
                  >
                    <PageIcon
                      icon={page.icon}
                      fallback={FileText}
                      className="inline-flex w-4 justify-center text-sm"
                    />
                    {/* Underlined alone, so the line never runs under the icon. */}
                    <span className="min-w-0 truncate group-hover:underline">{page.title}</span>
                  </button>
                </td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{page.blocks}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{page.references}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{page.taggedBy}</td>
                <td className="py-1.5 pl-4 text-right whitespace-nowrap text-muted tabular-nums">
                  {page.edited === undefined ? '—' : time.format(page.edited)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
