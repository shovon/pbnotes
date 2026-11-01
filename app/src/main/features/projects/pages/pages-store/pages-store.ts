/**
 * The app's side of pages: what `@pbnotes/pages` does not know because it is
 * about this app rather than about the log. Which day is today and which place
 * is showing belong to the window; how much of the folder could be read, and
 * the fold's version, belong to the ledger, and are on the view.
 *
 * Deliberately free of `electron` imports: callers hand in the view, which
 * keeps the store runnable under `node --test`.
 */
import { getPage, getPages, getPreviews, getReferences } from "@pbnotes/pages";
import type { Page, PagesView as Base } from "@pbnotes/pages";
import type { Place, PlaceView } from "../../../../../shared/pages.ts";
import type { LogStatus } from "../../../../../shared/log.ts";

/**
 * The view `ledgers.ts` hands out: the package's, and how much of the log
 * could be read, which the package has no business knowing.
 */
export type PagesView = Base & {
  /**
   * How much of the folder this ledger is kept in could be read, and what in
   * it was skipped. Nothing here is an error to clear — a session whose log is
   * still syncing is a normal state that usually heals itself — but none of it
   * may be skipped without the user being able to find out.
   */
  readonly status: LogStatus;
  /**
   * The fold's version as `state` stands: one more every time it changes.
   * Read beside `state`, with no `await` between, it labels what was read.
   */
  readonly version: number;
};

/**
 * Everything that shows at `place`: the one page, or with no place the
 * journal, each with what links to it, and what every ref quotes, labelled
 * with the version of the fold it was read at. Read in one turn, so the label
 * and the content cannot disagree.
 *
 * Today is in the journal whether or not it has been written on: it is the
 * day the user is about to type in. Handed in, because which day that is
 * belongs to the clock and not to the log. Sorted again only when it is
 * added, and only because a day dated later than today can exist — another
 * machine with a fast clock, or a folder that travelled backwards across a
 * date line.
 *
 * An empty today is asked what links to it too: other days can name it. Not
 * under a zoom, where what links to the page is not about the block showing.
 *
 * ponytail: the whole history, on every change. Send only the days in view
 * when someone has enough years in one ledger for that to show.
 */
export function getView(
  view: PagesView,
  at: Place | undefined,
  today: string,
): PlaceView {
  const { state, version } = view;
  let pages: Page[];
  if (at) {
    pages = [getPage(state, at.page)];
  } else {
    pages = getPages(state);
    if (!pages.some((page) => page.title === today)) {
      pages = [{ title: today, blocks: [] }, ...pages].sort((a, b) =>
        b.title.localeCompare(a.title),
      );
    }
  }
  return {
    version,
    showing: pages.map((page) => ({
      page,
      references: at?.block ? [] : getReferences(state, page.title),
    })),
    previews: getPreviews(state),
  };
}
