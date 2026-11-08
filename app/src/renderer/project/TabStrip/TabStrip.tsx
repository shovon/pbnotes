/**
 * The window's tabs, in the title bar after the way back (#303): one entry
 * per tab, named for what it shows, the active one marked. A click on an
 * entry shows that tab, its × closes it, and + opens a new one on the
 * journal. It shows with one tab too, so there is always somewhere to see
 * that tabs are there.
 *
 * Tabs, not buttons: each fills the title bar's height, edge to edge with
 * the next, the active one in the page's own colour, as if the page came
 * up into it, the rest the bar's own colour (`bar`, a shade off the page).
 * The colours are placeholders until the strip is designed.
 *
 * Every tab is one width, whatever it is called (#311), so the strip is
 * even and a tab's × stays put when its page is renamed. A name that does
 * not fit is cut short; its tooltip has it whole.
 *
 * Closing a tab while the pointer is on the strip keeps every tab the width
 * it was, as a browser does: the next tab's × comes under the pointer, so a
 * row of them closes with clicks in one place. Once the pointer leaves the
 * strip, they take the width that now fits. The strip sits in the title
 * bar, whose drag region the window hears nothing over, so leaving it is
 * heard once the pointer reaches somewhere that is not drag region.
 *
 * Only the entries and the + take the pointer: the room around them stays
 * the title bar, which drags the window. Many tabs shrink, all alike, to a
 * width a short name still reads in, then scroll sideways, with the active
 * one kept in sight and the + outside what scrolls, so it is always there.
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import PageIcon from '../PageIcon/PageIcon';

export type StripTab = {
  id: string;
  /** What the tab shows: a page's name, "Journal" or "All pages". */
  label: string;
  /** The page's icon, drawn before its name when it can be (#323). */
  icon?: string;
};

type Props = {
  tabs: readonly StripTab[];
  /** The id of the tab drawn. */
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
};

export default function TabStrip({ tabs, active, onSelect, onClose, onNew }: Props) {
  const list = useRef<HTMLDivElement>(null);
  /** The width every tab keeps after a close, until the pointer leaves the strip. */
  const [kept, setKept] = useState<number | null>(null);
  /** Closes `id` from a pointer on its tab, keeping that tab's width for the rest. */
  const closeFrom = (event: MouseEvent<HTMLElement>, id: string) => {
    const tab = event.currentTarget.closest('[data-tab]');
    if (tab) setKept(tab.getBoundingClientRect().width);
    onClose(id);
  };
  // The active tab in sight, however it became active: opened past the
  // end of what shows, or reached by a click on a tab half out of view.
  // The whole of it, its × and border too, not only the label it is named by.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.closest('[data-tab]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);
  return (
    <div className="flex h-full min-w-0 items-stretch" onPointerLeave={() => setKept(null)}>
      <div
        ref={list}
        role="tablist"
        aria-label="Tabs"
        className="flex h-full min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map(({ id, label, icon }) => {
          const on = id === active;
          return (
            <div
              key={id}
              data-tab
              // One width each, from the same basis, so they shrink alike.
              // Kept as it was after a close: not shrinking or growing until
              // the pointer leaves.
              style={kept === null ? undefined : { width: kept, minWidth: kept, flexShrink: 0 }}
              className={`app-region-no-drag group flex w-44 min-w-24 shrink items-center border-r border-line text-sm ${
                on ? 'bg-bg text-fg' : 'text-muted hover:bg-line hover:text-fg'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={on}
                title={label}
                className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-0.5 pl-2.5 text-left"
                onClick={() => onSelect(id)}
                // A middle click closes, as in a browser.
                onAuxClick={(event) => {
                  if (event.button === 1) closeFrom(event, id);
                }}
              >
                <PageIcon icon={icon} />
                <span className="truncate">{label}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${label}`}
                title="Close tab"
                className={`h-full cursor-pointer px-1.5 leading-none hover:text-accent ${
                  on ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`}
                onClick={(event) => closeFrom(event, id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New tab"
        title="New tab"
        className="app-region-no-drag shrink-0 cursor-pointer px-2.5 text-sm text-muted hover:bg-line hover:text-fg"
        onClick={onNew}
      >
        +
      </button>
    </div>
  );
}
