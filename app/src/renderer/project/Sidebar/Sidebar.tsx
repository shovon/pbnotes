import { isShowing } from "./recent/recent";

/**
 * The left column of a project (#184): the ways to get somewhere that don't
 * depend on the page on screen. The journal, the list of every page (#200),
 * and the pages opened lately.
 * This project's only: it is handed its list and knows of no other.
 *
 * Fixed under the title-bar strip, the height of the window, with its own
 * scroll. Its column reaches up through the strip as well, behind the
 * toggle and the picker, so the strip's rule stops at its edge and its own
 * rule runs to the top of the window. `App` makes room for it beside the page while it is in the DOM;
 * collapsed, `ProjectView` leaves it out altogether.
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
  /** A recent page was clicked; `beside` is Shift held, for the right sidebar (#287). */
  onOpen: (page: string, beside: boolean) => void;
};

const entry =
  "block w-full cursor-pointer truncate rounded-md px-2 py-1 text-left text-sm hover:bg-line";
const current = "bg-line font-medium";

export default function Sidebar({
  recent,
  showing,
  browsing,
  onJournal,
  onAllPages,
  onOpen,
}: Props) {
  const journal = showing === undefined && !browsing;
  return (
    <>
      {/* The column's top, laid over the strip's backing (it comes later at
        the same layer) and under the header, which sits a layer above. It
        hangs one pixel below the strip to cover the strip's rule. It says
        nothing about dragging: it comes after the header in the DOM, so
        claiming the drag here would take the toggle's and picker's clicks
        too, and the backing under it drags already. */}
      <div
        aria-hidden
        className="fixed top-0 left-0 z-20 h-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar))+1px)] w-sidebar border-r border-line bg-bg"
      />
      <nav
        id="sidebar"
        aria-label="Sidebar"
        data-sidebar
        className="fixed top-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar)))] bottom-0 left-0 z-10 w-sidebar overflow-y-auto border-r border-line bg-bg px-2 py-3"
      >
        <button
          type="button"
          className={`${entry} ${journal ? current : ""}`}
          aria-current={journal ? "page" : undefined}
          onClick={onJournal}
        >
          Journal
        </button>
        <button
          type="button"
          className={`${entry} ${browsing ? current : ""}`}
          aria-current={browsing ? "page" : undefined}
          onClick={onAllPages}
        >
          All pages
        </button>

        <h2 className="mt-4 mb-1 px-2 text-xs font-semibold tracking-wide text-muted uppercase">
          Recent
        </h2>
        {recent.length === 0 ? (
          <p className="px-2 text-sm text-muted">
            Pages you open show up here.
          </p>
        ) : (
          <ul>
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
                    onClick={(event) => onOpen(page, event.shiftKey)}
                  >
                    {page}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </>
  );
}
