/**
 * What shows at a place: the fold, read for one window. Which day is today
 * and which place is showing belong to the window, and are handed in.
 *
 * Pure: it reads the fold it is handed and holds nothing.
 */
import { getPage, getPages, getPreviews, getProperties, getReferences } from "@pbnotes/pages";
import type { Page, Pages } from "@pbnotes/pages";
import type { Place, PlaceView } from "../../../../../shared/pages.ts";

/**
 * Everything that shows at `place`: the one page, or with no place the
 * journal, each with what links to it, and what every ref quotes, labelled
 * with `version`. Read in one turn, so the label and the content cannot
 * disagree.
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
 * Every page carries its properties, under a zoom too: whether to draw them
 * is the window's.
 *
 * ponytail: the whole history, on every change. Send only the days in view
 * when someone has enough years in one ledger for that to show.
 */
export function getView(
  view: { readonly state: Pages; readonly version: number },
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
      properties: getProperties(state, page.title),
    })),
    previews: getPreviews(state),
  };
}
