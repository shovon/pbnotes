import { useEffect, useMemo, useState } from 'react';
import { today } from '@pbnotes/graph';
import type { GraphApi, PlaceView } from '../../../../shared/graph';
import type { Act } from '../../../ui';
import { Previews } from '../../Block/Block';
import PageView from '../../PageView/PageView';
import type { PageViewGraph } from '../../PageView/PageView';
import { createFetcher } from '../../fetcher/fetcher';

/** The part of the bridge a card calls: what its page does, and asking for it. */
export type CardGraph = PageViewGraph & Pick<GraphApi, 'view' | 'onChanged'>;

/** What a card shows of its page, for whatever acts on blocks across views. */
export type Shown = PlaceView['showing'][number];

type Props = {
  graph: CardGraph;
  /** The page, as it was opened. */
  title: string;
  /** The clock, for the journal day main reads the page against. */
  now: () => Date;
  /**
   * Which view this is, for selecting blocks (#253): never the page's own
   * title, which the main view uses for the same page.
   */
  scope: string;
  /** The × was clicked. */
  onClose: () => void;
  /** What the card draws now: for copying a selection that reaches into it. */
  onShown?: (shown: Shown) => void;
  act: Act;
};

/**
 * One page kept open in the right sidebar (#287): its title, tags,
 * properties and blocks, all editable, as the page is anywhere else. Not
 * what links to it, or what tags it: that is the page's own view.
 *
 * Asks main for its page as the main view asks for its place, through a
 * fetcher of its own (`fetcher/`), on opening and on every change heard,
 * so a write anywhere shows here and a write here shows everywhere.
 *
 * The title is not a link: clicking it opens nothing. The × closes the card.
 */
export default function Card({ graph, title, now, scope, onClose, onShown, act }: Props) {
  const [view, setView] = useState<PlaceView | null>(null);

  const [fetcher] = useState(() => {
    const place = { page: title };
    return createFetcher({
      view: (at, through) => graph.view(at, today(now()), through),
      where: () => place,
      onAnswer: (held) => setView(held.view),
      onError: (error) => act(() => Promise.reject(error)),
    });
  });

  useEffect(() => {
    fetcher.moved();
    const off = graph.onChanged(fetcher.heard);
    // A stubbed bridge (Storybook's) answers with something that is not an
    // unsubscribe.
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  /** The bridge handed to the page: a write's reply is heard here too. */
  const bridge = useMemo<CardGraph>(
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

  const shown = view?.showing[0];
  useEffect(() => {
    if (shown) onShown?.(shown);
  }, [shown]);

  const previews = useMemo(() => new Map(view?.previews), [view?.previews]);

  return (
    <section
      aria-label={title}
      // Not boxed: a stretch of the column with a rule under it, the last
      // card's too. The page's own heading, smaller, and clear of the ×.
      className="relative border-b border-line bg-bg px-3 [&_h2]:mt-2 [&_h2]:mb-2 [&_h2]:pr-6 [&_h2]:text-lg [&_h2]:break-words"
    >
      <button
        type="button"
        aria-label={`Close ${title}`}
        title="Close"
        className="absolute top-2 right-2 z-10 cursor-pointer rounded-md px-1.5 leading-6 text-muted hover:bg-line hover:text-fg"
        onClick={onClose}
      >
        ×
      </button>
      {shown ? (
        // A name on what the card shows, for an image dropped on it.
        <div data-page={shown.page.title} className="contents">
          <Previews value={previews}>
            <PageView
              graph={bridge}
              page={shown.page}
              version={view.version}
              links={0}
              properties={shown.properties}
              tags={shown.tags}
              scope={scope}
              act={act}
            />
          </Previews>
        </div>
      ) : (
        <>
          <h2 className="font-semibold">{title}</h2>
          <p className="pb-3 text-sm text-muted">Loading…</p>
        </>
      )}
    </section>
  );
}
