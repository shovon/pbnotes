import { useEffect, useState } from 'react';
import type { Availability, Project } from '../../shared/projects';
import type { Page } from '../../shared/pages';
import { today } from '../ui';
import type { Act } from '../ui';
import PageView from './PageView/PageView';

const { pages } = window.gnotes;

type Props = {
  project: Project;
  availability: Availability;
  act: Act;
};

/**
 * A project, in one of two shapes. By default the journal: every day that has
 * anything on it, newest first, with today at the top. Follow a link and it
 * is that one page instead, with a way back to the journal above it.
 *
 * Which page is showing is ordinary state, for the reason `App` gives about
 * which project is showing: there is no address bar, so there is no URL for
 * a router to own. Null is the journal.
 *
 * The journal comes in one read. A project's pages are folded out of a single
 * log whether the view asks for one of them or all of them, so there is
 * nothing to save by asking for less — and a day is only ever a heading and a
 * handful of lines. Each `PageView` owns its page from there on; writes hand
 * the folded page straight back, so nothing re-reads the whole stack to add a
 * block.
 *
 * ponytail: the whole history renders at once. Add windowing when someone has
 * enough years in one project for that to show.
 */
export default function ProjectView({ project, act }: Props) {
  // ponytail: read once per render, so a window left open across midnight
  // keeps yesterday at the top until something re-renders it. Add a timer to
  // the next local midnight if that ever bites.
  const date = today();
  const [title, setTitle] = useState<string | null>(null);
  const [stack, setStack] = useState<Page[] | null>(null);

  /**
   * The two updates in one event, so they land in one render: the stack is
   * gone in the very render that changes the title. Clearing it from the
   * effect instead is too late — that render has already mounted a `PageView`
   * for the new title on the *old* stack (an empty today, say), and a
   * `PageView` reads its page once, on mount. The effect's clear is then
   * batched with the read that follows a millisecond later, "Loading…" never
   * commits, and the stale instance keeps its empty page with the same key.
   */
  const go = (next: string | null) => {
    setTitle(next);
    setStack(null);
  };

  useEffect(() => {
    let current = true;
    window.scrollTo(0, 0);
    const read =
      title === null
        ? pages.openAll(project.id)
        : pages.open(project.id, title).then((page) => [page]);
    // A rejected read must not strand the view on "Loading…". The only title
    // main refuses is one the link plugin never produces, so there is nothing
    // to tell the user beyond an empty page.
    void read
      .catch((): Page[] => [])
      .then((next) => {
        if (current) setStack(next);
      });
    // Dropped if the view moves to another project or page, or the day rolls
    // over mid-session, so a slow read cannot paint the wrong thing.
    return () => {
      current = false;
    };
  }, [project.id, date, title]);

  /**
   * Today is in the journal whether or not it has been written on: it is the
   * day the user is about to type in, and main leaves it out until it has
   * blocks because it has no opinion about which day today is. A single page
   * is left exactly as it was read.
   *
   * Sorted again only in that case, and only because a day dated later than
   * today can exist — another machine with a fast clock, or a folder that
   * travelled backwards across a date line. Rare, and not worth rendering out
   * of order over.
   */
  const shown =
    stack === null || title !== null || stack.some((page) => page.title === date)
      ? stack
      : [{ title: date, blocks: [] }, ...stack].sort((a, b) =>
          b.title.localeCompare(a.title),
        );

  /**
   * Every wikilink in every block lands here, in the capture phase, before
   * the block it sits in can turn the click into an edit. Stopping it there
   * is what keeps the editor closed: React's bubbling `onClick` on the block
   * never runs. The page is read off the attribute, not `href` — that one
   * comes back absolute and percent-encoded.
   */
  const follow = (event: React.MouseEvent) => {
    const link = (event.target as Element).closest('a.wikilink[href]');
    const page = link?.getAttribute('href')?.slice(1);
    if (!page) return;
    event.preventDefault();
    event.stopPropagation();
    go(page);
  };

  return (
    <div onClickCapture={follow}>
      {title !== null && (
        <button className="back" onClick={() => go(null)}>
          ← Journal
        </button>
      )}

      {shown === null ? (
        <p className="subtitle">Loading…</p>
      ) : (
        shown.map((page) => (
          // Keyed by the title, so a page is never handed another page's
          // editor state — the open box and the block id in it belong to the
          // page they were opened on.
          <PageView
            key={page.title}
            project={project}
            initial={page}
            act={act}
          />
        ))
      )}
    </div>
  );
}
