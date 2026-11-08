import { useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/projects';

/**
 * The option that opens the directory picker instead of switching project.
 * A value no id can collide with — ids are uuids.
 */
const ADD = 'add';

type Props = {
  projects: Project[];
  projectId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
};

/**
 * Which project is open, as a plain `<select>`: one click to the list, one to
 * switch. Native means the platform's own menu, keyboard behaviour and
 * type-ahead for free, and it stays right for forty projects as well as for
 * two.
 *
 * As wide as the room it is given, whatever the project is called: `App`
 * gives it up to the sidebar's edge, so it does not jump in width from one
 * project to the next, and a long name is cut short rather than pushed into
 * the tabs (#303). Cut short, pointing at it fades in a wider picker over it, with
 * the whole name, so the open project can be read without opening the list.
 */
/** The wider picker's look, for the one shown and the one measured. */
const wider =
  'flex w-max max-w-[calc(100vw-9rem)] items-center gap-1.5 rounded-md border border-accent bg-bg py-0.5 pr-2 pl-2 font-semibold whitespace-nowrap shadow-md';

/**
 * The chevron both draw, the picker's own in place of the platform's, which
 * sits inside the select's padding wherever that is and so cannot be given
 * room of its own.
 */
function Chevron({ className = '' }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * Its name and chevron, laid out to take the very room the select's do: the
 * name starts where the select's starts, and the chevron sits as far from
 * the right edge, so nothing shifts as it fades in, and the two measure the
 * same for a name that fits.
 */
function Whole({ name }: { name: string }) {
  return (
    <>
      <span className="truncate">{name}</span>
      <Chevron />
    </>
  );
}

export default function ProjectPicker({ projects, projectId, onSelect, onAdd }: Props) {
  const name = projects.find((it) => it.id === projectId)?.name ?? '';
  const select = useRef<HTMLSelectElement>(null);
  const measured = useRef<HTMLSpanElement>(null);
  /** Whether the name is cut short, so the wider picker is worth showing. */
  const [cut, setCut] = useState(false);
  // A copy of the wider picker, unseen and far off the window, at its full
  // width: wider than the real one is the name cut short. Measured before
  // paint, and again whenever either changes size.
  useLayoutEffect(() => {
    const it = select.current;
    const full = measured.current;
    if (!it || !full) return;
    const measure = () => setCut(full.offsetWidth > it.offsetWidth + 1);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(it);
    seen.observe(full);
    return () => seen.disconnect();
  }, [name]);
  return (
    <span className="relative mx-1.5 flex min-w-0 flex-1">
      {/* Sits in the title bar strip, so it takes itself back out of the drag
          region or it cannot be clicked. Borderless until pointed at: at the
          top of the window it reads as the name of what is open, and a
          permanent box up there is chrome for chrome. Fills its room rather
          than fitting its name, so it is one width for every project. */}
      <select
        ref={select}
        className="peer app-region-no-drag w-full min-w-0 cursor-pointer appearance-none text-ellipsis rounded-md border border-transparent py-0.5 pr-6 pl-2 font-semibold hover:border-accent"
        aria-label="Project"
        /* Controlled, so picking "Open project…" snaps back to the open
           project while the directory dialog decides what happens next. */
        value={projectId}
        onChange={(event) => (event.target.value === ADD ? onAdd() : onSelect(event.target.value))}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
        <option value={ADD}>Open project…</option>
      </select>
      {/* Over the select's own right padding, as far in as the wider
          picker's: out of the drag region, or it would take the clicks it
          lies over, and taking no pointer, so they reach the select. */}
      <Chevron className="app-region-no-drag pointer-events-none absolute top-1/2 right-[9px] -translate-y-1/2" />
      {/* What is measured: off the window, so it lies over nothing. Anything
          over the picker would take the title bar's drag region with it and
          take the picker's clicks for dragging the window. */}
      <span ref={measured} aria-hidden className={`${wider} invisible fixed -top-[9999px] left-0`}>
        <Whole name={name} />
      </span>
      {/* The picker as it would be with room for the whole name, floating
          over the real one from where it starts, out over the tabs, up to the
          window's edge: faded in after a moment's pointing, and only when the
          name is cut short. Not displayed at all until the select is
          hovered, by CSS alone, so while hidden it lies over nothing; shown,
          it is out of the drag region and takes no pointer, so a click still
          lands on the picker and opens its list. The fade starts each time it
          is displayed. */}
      {cut && (
        <span
          aria-hidden
          className={`${wider} app-region-no-drag pointer-events-none absolute top-1/2 left-0 z-40 hidden -translate-y-1/2 animate-[fade-in_150ms_ease-out_300ms_both] peer-hover:flex`}
        >
          <Whole name={name} />
        </span>
      )}
    </span>
  );
}
