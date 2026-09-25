import { useEffect, useState } from 'react';
import type { Availability, Project } from '../../shared/projects';
import type { Page } from '../../shared/pages';
import { today } from '../ui';
import type { Act } from '../ui';
import DayPage from './DayPage/DayPage';

const { pages } = window.gnotes;

type Props = {
  project: Project;
  availability: Availability;
  act: Act;
};

/**
 * The default view of a project: every day that has anything on it, newest
 * first, with today at the top.
 *
 * All of them, in one read. A project's days are folded out of a single log
 * whether the view asks for one of them or all of them, so there is nothing
 * to save by asking for less — and a day is only ever a heading and a handful
 * of lines. Each `DayPage` owns its day from there on; writes hand the folded
 * page straight back, so nothing re-reads the whole stack to add a block.
 *
 * ponytail: the whole history renders at once. Add windowing when someone has
 * enough years in one project for that to show.
 */
export default function ProjectView({ project, act }: Props) {
  // ponytail: read once per render, so a window left open across midnight
  // keeps yesterday at the top until something re-renders it. Add a timer to
  // the next local midnight if that ever bites.
  const date = today();
  const [days, setDays] = useState<Page[] | null>(null);

  useEffect(() => {
    let current = true;
    void pages.openAll(project.id).then((next) => {
      if (current) setDays(next);
    });
    // Dropped if the view moves to another project or the day rolls over
    // mid-session, so a slow read cannot paint the wrong project's days.
    return () => {
      current = false;
    };
  }, [project.id, date]);

  /**
   * Today is in the stack whether or not it has been written on: it is the
   * day the user is about to type in, and main leaves it out until it has
   * blocks because it has no opinion about which day today is.
   *
   * Sorted again only in that case, and only because a day dated later than
   * today can exist — another machine with a fast clock, or a folder that
   * travelled backwards across a date line. Rare, and not worth rendering out
   * of order over.
   */
  const stack =
    days === null || days.some((page) => page.date === date)
      ? days
      : [{ date, blocks: [] }, ...days].sort((a, b) =>
          b.date.localeCompare(a.date),
        );

  if (stack === null) return <p className="subtitle">Loading…</p>;

  return (
    <>
      {stack.map((page) => (
        // Keyed by the day, so a day is never handed another day's editor
        // state — the open box and the block id in it belong to the page they
        // were opened on.
        <DayPage
          key={page.date}
          project={project}
          initial={page}
          act={act}
        />
      ))}
    </>
  );
}
