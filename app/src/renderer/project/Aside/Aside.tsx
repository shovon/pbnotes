import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fit, widthAt } from './width/width';
import { column } from '../column/column';

/** The right sidebar's column name (`column/`). */
const ASIDE = 'aside';

type Props = {
  /**
   * How wide it was made, in pixels. Drawn narrower in a window too narrow
   * for it, and this wide again once the window is wide enough.
   */
  width: number;
  /** Its edge was dragged: the width it should be now. */
  onResize: (width: number) => void;
  /** The cards, most recently opened first. */
  children: ReactNode;
};

/**
 * The right sidebar (#287): pages kept open beside the one on screen, one
 * card each, stacked. `Tab` leaves it out while it holds no card.
 *
 * Fixed under the title-bar strip, the height of the window, with its own
 * scroll. While it is in the DOM `App` leaves room for it beside the page,
 * as wide as `--aside-width` says, which this sets on the document while it
 * is mounted. Its left edge drags to resize it.
 */
export default function Aside({ width: chosen, onResize, children }: Props) {
  const [room, setRoom] = useState(() => window.innerWidth);
  useEffect(() => {
    const resized = () => setRoom(window.innerWidth);
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  const width = fit(chosen, room);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--aside-width', `${width}px`);
    return () => {
      root.style.removeProperty('--aside-width');
    };
  }, [width]);

  /** The listeners of a resize going on, to take off when it ends. */
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const startResize = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    // Not text selected along the way.
    event.preventDefault();
    const move = (moved: MouseEvent) => onResize(widthAt(moved.clientX, window.innerWidth));
    const end = () => stop.current?.();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    document.documentElement.dataset.resizingAside = '';
    stop.current = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      delete document.documentElement.dataset.resizingAside;
      stop.current = null;
    };
  };

  return (
    <aside
      aria-label="Pages beside"
      data-aside
      style={{ width }}
      className="fixed top-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar)))] right-0 bottom-0 z-10 border-l border-line bg-bg"
    >
      {/* On the edge, a little either side of the border. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize"
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize hover:bg-accent/30"
        onMouseDown={startResize}
      />
      {/* The cards edge to edge, the full width of the column and flush with
          its top; each card rules itself off below. */}
      {/* A column of its own (#305): it scrolls on its own, and a drag in
          it measures its rows, never the page's beside it. */}
      <div {...column(ASIDE)} className="flex h-full flex-col overflow-y-auto">
        {children}
      </div>
    </aside>
  );
}
