import { useEffect, useMemo, useRef, useState } from 'react';
import type { Page } from '@pbnotes/graph';
import { X } from 'lucide-react';
import Icon from '../../Icon/Icon';
import type { Filter, GraphApi, TaskView } from '../../../shared/graph';
import type { Act } from '../../ui';
import { Previews } from '../Block/Block';
import PageView from '../PageView/PageView';
import type { PageViewGraph } from '../PageView/PageView';
import { under } from '../selection/shown';
import { createTaskFetcher } from './fetch/fetch';
import { chips, picked, unchipped } from './filter/filter';

/** The part of the bridge the Tasks view calls: what each page does, and asking for its tasks. */
export type TasksGraph = PageViewGraph & Pick<GraphApi, 'tasks' | 'onChanged' | 'filterMenu'>;

type Props = {
  graph: TasksGraph;
  /** Which tasks show: the tab's (`TabState.filter`), so back to the view finds it as it was. */
  filter: Filter;
  onFilter: (filter: Filter) => void;
  /** Which view this is, for selecting blocks (#253): each page's cut is `under` it. */
  scope: string;
  /** The pages drawn now: for copying a selection that reaches into them. */
  onShown?: (pages: Page[]) => void;
  act: Act;
};

/**
 * Every task in the project (#387), drawn as what it is: blocks on pages.
 * Each page with a task is a cut of it, the way a linked reference is: a
 * `PageView` headed by the page, as a link there, holding its tasks with
 * their children. So a task here is edited, ticked, selected, dragged and
 * copied as it is anywhere else, and a write to it is a write to its page.
 *
 * Above the pages, the filter: a chip for each value it holds, whose ×
 * takes it off, and `+ Filter`, which pops up the native menu of what can
 * be added (`filterMenu`). The first sketch of block filters, so the
 * heading says how many show of how many there are, and it is always clear
 * something is hidden.
 *
 * Asks main for its tasks through a fetcher of its own (`fetch/`), when the
 * filter changes and on every change heard, and loads the pages a chunk at
 * a time as the window scrolls, as linked references load (#285).
 */
export default function Tasks({ graph, filter, onFilter, scope, onShown, act }: Props) {
  const [view, setView] = useState<TaskView | null>(null);

  /** The filter as of this render, for the fetcher made once. */
  const current = useRef(filter);
  current.current = filter;

  const [fetcher] = useState(() =>
    createTaskFetcher({
      tasks: (on, through) => graph.tasks(on, through),
      filter: () => current.current,
      onAnswer: setView,
      onError: (error) => act(() => Promise.reject(error)),
    }),
  );

  // By value, not identity: the tab hands back the very filter for a step
  // that changes nothing, but a filter rebuilt with the same values is the
  // same question.
  const asked = JSON.stringify(filter);
  useEffect(() => fetcher.moved(), [asked]);

  useEffect(() => {
    const off = graph.onChanged(fetcher.heard);
    // A stubbed bridge (Storybook's) answers with something that is not an
    // unsubscribe.
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  /** The bridge handed to each page: a write's reply is heard here too. */
  const bridge = useMemo<TasksGraph>(
    () => ({
      ...graph,
      run: async (command) => {
        const v = await graph.run(command);
        if (typeof v === 'number') fetcher.heard(v);
        return v;
      },
    }),
    [graph],
  );

  useEffect(() => {
    if (view) onShown?.(view.pages);
  }, [view]);

  const previews = useMemo(() => new Map(view?.previews), [view?.previews]);

  /** Below the pages while there are more to load: coming within a couple of screens asks for them. */
  const more = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const marker = more.current;
    if (!marker) return;
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((it) => it.isIntersecting)) fetcher.more();
      },
      { rootMargin: '0px 0px 200% 0px' },
    );
    seen.observe(marker);
    return () => seen.disconnect();
  }, [view]);

  const add = useRef<HTMLButtonElement>(null);
  const openMenu = () =>
    act(async () => {
      const rect = add.current?.getBoundingClientRect();
      const pick = await graph.filterMenu({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 }, filter);
      if (pick) onFilter(picked(filter, pick));
    });

  return (
    <section aria-labelledby="tasks-title" className="pb-12">
      <h2 id="tasks-title" className="mt-6 mb-2 text-2xl font-semibold">
        Tasks
        {view && (
          <span className="ml-2 text-base font-normal text-muted">
            {view.shown === view.total ? view.total : `${view.shown} of ${view.total}`}
          </span>
        )}
      </h2>

      <div role="group" aria-label="Filter" className="mb-6 flex flex-wrap items-center gap-1.5 text-sm">
        {chips(filter).map((chip) => (
          <span
            key={`${chip.kind}:${chip.marker}`}
            title={`Marker is ${chip.marker}`}
            className="inline-flex items-center rounded-md bg-accent/10 text-accent"
          >
            <span className="py-0.5 pr-0.5 pl-2 text-xs font-semibold tracking-wide">{chip.marker}</span>
            <button
              type="button"
              aria-label={`Remove ${chip.marker}`}
              className="cursor-pointer rounded-md py-0.5 pr-1.5 pl-0.5 hover:text-danger"
              onClick={() => onFilter(unchipped(filter, chip))}
            >
              <Icon of={X} />
            </button>
          </span>
        ))}
        <button
          ref={add}
          type="button"
          className="cursor-pointer rounded-md px-2 py-0.5 text-muted hover:bg-line/50 hover:text-fg"
          onClick={openMenu}
        >
          + Filter
        </button>
      </div>

      {view === null ? (
        <p className="mt-1 text-sm text-muted">Loading…</p>
      ) : view.total === 0 ? (
        <p className="mt-1 text-sm text-muted">
          No tasks yet. Start a block with TODO, and it shows up here.
        </p>
      ) : view.shown === 0 ? (
        <p className="mt-1 text-sm text-muted">No tasks meet this filter.</p>
      ) : (
        <Previews value={previews}>
          {view.pages.map((page) => (
            // Keyed by the title, so a page is never handed another page's
            // editor state. The element is only a name on what the page
            // shows, for a drop to read; it has no box.
            <div key={page.title} data-page={page.title} className="contents">
              <PageView
                graph={bridge}
                page={page}
                version={view.version}
                scope={under(scope, page.title)}
                act={act}
                reference
              />
            </div>
          ))}
        </Previews>
      )}

      {view?.list.next && (
        <p ref={more} className="mt-1 text-sm text-muted">
          Loading more tasks…
        </p>
      )}
    </section>
  );
}
