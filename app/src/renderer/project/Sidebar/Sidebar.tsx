import { CalendarDays, ChevronDown, ChevronRight, Files } from "lucide-react";
import Icon from "../../Icon/Icon";
import { isShowing } from "./recent/recent";
import type { Keys } from "../opening/opening";

/**
 * The left column of a project (#184): the ways to get somewhere that don't
 * depend on the page on screen. The journal, the list of every page (#200),
 * and the pages opened lately.
 * This project's only: it is handed its list and knows of no other.
 *
 * Fixed under the title-bar strip, the height of the window, with its own
 * scroll. Its column reaches up through the strip as well, behind the
 * toggle and the picker, so the strip's rule stops at its edge and its own
 * rule runs to the top of the window. `App` makes room for it beside the page
 * while it is in the DOM; collapsed, `ProjectView` leaves it out altogether.
 *
 * Floating, it is the same column laid over the page while it is collapsed
 * (pointing at the toggle shows it, `peek.ts`): without `data-sidebar`, so
 * `App` makes no room for it, a layer up and with a shadow off its edge.
 *
 * Recent collapses to its heading (#299). Whether it is is handed in, since
 * the docked sidebar and the floating one are not the same element and must
 * agree; collapsed, the list is still in the DOM, hidden, so the heading's
 * `aria-controls` always names something.
 */
type Props = {
  /** Titles, newest first. */
  recent: readonly string[];
  /** The page on screen, or undefined on the journal or the list. */
  showing: string | undefined;
  /** Whether the list of every page is on screen. */
  browsing: boolean;
  onJournal: () => void;
  onAllPages: () => void;
  /**
   * A recent page was clicked, with the keys held, which say where it
   * opens: here, beside (#287) or in a new tab (#309, `opening/`).
   */
  onOpen: (page: string, keys: Keys) => void;
  /** Whether Recent shows only its heading. */
  recentCollapsed: boolean;
  /** The Recent heading was clicked. */
  onToggleRecent: () => void;
  /** Laid over the page rather than beside it. */
  floating?: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
};

const entry =
  "block w-full cursor-pointer truncate rounded-md px-2 py-1 text-left text-sm hover:bg-line/50";
const current = "bg-line/50 font-medium";
/** A fixed entry: an icon, then its label, which is cut short if need be. */
const place =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-line/50";

export default function Sidebar({
  recent,
  showing,
  browsing,
  onJournal,
  onAllPages,
  onOpen,
  recentCollapsed,
  onToggleRecent,
  floating = false,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const journal = showing === undefined && !browsing;
  const hover = { onPointerEnter, onPointerLeave };
  // Floating: above the page and its own raised bits, still under the header.
  const lift = floating ? "z-20 shadow-[6px_0_16px_-8px_rgb(0_0_0/0.25)]" : "z-10";
  return (
    <>
      {/* The column's top, laid over the strip's backing (it comes later at
        the same layer) and under the header, which sits a layer above. It
        hangs one pixel below the strip to cover the strip's rule. It says
        nothing about dragging: it comes after the header in the DOM, so
        claiming the drag here would take the toggle's and picker's clicks
        too, and the backing under it drags already. Floating, it takes no
        drag at all, so pointing at it keeps the sidebar showing. */}
      <div
        aria-hidden
        {...hover}
        className={`${floating ? "app-region-no-drag shadow-[6px_0_16px_-8px_rgb(0_0_0/0.25)]" : ""} fixed top-0 left-0 z-20 h-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar))+1px)] w-sidebar border-r border-line bg-bg`}
      />
      <nav
        id="sidebar"
        aria-label="Sidebar"
        data-sidebar={floating ? undefined : true}
        {...hover}
        className={`${lift} fixed top-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar)))] bottom-0 left-0 w-sidebar overflow-y-auto border-r border-line bg-bg px-2 py-3`}
      >
        <div className="flex flex-col gap-px">
          <button
            type="button"
            className={`${place} ${journal ? current : ""}`}
            aria-current={journal ? "page" : undefined}
            onClick={onJournal}
          >
            <Icon of={CalendarDays} />
            <span className="truncate">Journal</span>
          </button>
          <button
            type="button"
            className={`${place} ${browsing ? current : ""}`}
            aria-current={browsing ? "page" : undefined}
            onClick={onAllPages}
          >
            <Icon of={Files} />
            <span className="truncate">All pages</span>
          </button>
        </div>

        <h2 className="mt-4 mb-1">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-left text-xs font-semibold tracking-wide text-muted uppercase hover:bg-line/50"
            aria-expanded={!recentCollapsed}
            aria-controls="sidebar-recent"
            onClick={onToggleRecent}
          >
            Recent
            <Icon of={recentCollapsed ? ChevronRight : ChevronDown} />
          </button>
        </h2>
        <div id="sidebar-recent" hidden={recentCollapsed}>
          {recent.length === 0 ? (
            <p className="px-2 text-sm text-muted">
              Pages you open show up here.
            </p>
          ) : (
            // A hairline between entries, so two highlights side by side
            // read as two.
            <ul className="flex flex-col gap-px">
              {recent.map((page) => {
                const here = isShowing(page, showing);
                return (
                  <li key={page}>
                    <button
                      type="button"
                      className={`${entry} ${here ? current : ""}`}
                      aria-current={here ? "page" : undefined}
                      // Truncated to one line; the whole title on hover.
                      title={page}
                      onClick={(event) => onOpen(page, event)}
                    >
                      {page}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </nav>
    </>
  );
}
