/**
 * What shows at a place: the fold, read for one window. Which day is today
 * and which place is showing belong to the window, and are handed in.
 *
 * Pure: it reads the fold it is handed and holds nothing.
 */
import {
  blocksOn,
  getDays,
  getDeletions,
  getPage,
  getPreviews,
  getProperties,
  getReferences,
  getRefsTo,
  getTaggedBy,
  getTags,
} from "@pbnotes/graph";
import type { Page, Graph } from "@pbnotes/graph";
import type { Place, PlaceView } from "../../../../../shared/graph.ts";

/** How many more days with something on them a journal reads at a time (#282). */
export const DAYS = 10;

/**
 * Everything that shows at `place`: the one page, or with no place the
 * journal, each with what links to it, and what every ref on them quotes,
 * labelled with `version`. Read in one turn, so the label and the content
 * cannot disagree.
 *
 * The journal is read for a window (#282): every day on or after `from`. A
 * date, not a count, so a day arriving above it (today rolling over, another
 * device's day) is added at the top and none falls off the bottom. With no
 * `from`, the newest `DAYS` days with something on them. The answer says
 * which `from` it read, and the `from` that reads `DAYS` more, if there are
 * any; only the days in the window are read for what links to them.
 *
 * Today is in the journal whether or not it has been written on: it is the
 * day the user is about to type in, so the window always reaches it. Handed
 * in, because which day that is belongs to the clock and not to the log.
 * Sorted again only when it is added, and only because a day dated later
 * than today can exist — another machine with a fast clock, or a folder that
 * travelled backwards across a date line.
 *
 * An empty today is asked what links to it too: other days can name it. Not
 * under a zoom, where what links to the page is not about the block showing.
 * Every page carries its properties, under a zoom too: whether to draw them
 * is the window's. Its tags and what tags it are left out under a zoom, as
 * what links to it is: the zoom shows a block, not the page.
 */
export function getView(
  view: { readonly state: Graph; readonly version: number },
  at: Place | undefined,
  today: string,
  from?: string,
): PlaceView {
  const { state, version } = view;
  const journal = at ? undefined : window(getDays(state), today, from);
  const pages: Page[] = at
    ? [getPage(state, at.page)]
    : (journal?.days ?? []).map((day) => ({ title: day, blocks: blocksOn(state, day) }));
  const showing = pages.map((page) => ({
    page,
    references: at?.block ? [] : getReferences(state, page.title),
    properties: getProperties(state, page.title),
    tags: at?.block ? [] : getTags(state, page.title),
    taggedBy: at?.block ? [] : getTaggedBy(state, page.title),
    deletions: getDeletions(state, page.title),
    refsTo: at && !at.block ? getRefsTo(state, page.title) : 0,
  }));
  return {
    version,
    showing,
    previews: getPreviews(state, showing.flatMap((it) => [it.page, ...it.references])),
    ...(journal ? { journal: { from: journal.from, next: journal.next } } : {}),
  };
}

/**
 * Which of `days` (newest first) the journal shows: those on or after
 * `from`, or the newest `DAYS` without one, always reaching `today`, and
 * today among them. `next` is the `from` that shows `DAYS` more, or null
 * when nothing is older.
 */
function window(days: readonly string[], today: string, from: string | undefined) {
  const start = from ?? days[Math.min(DAYS, days.length) - 1] ?? today;
  const edge = start < today ? start : today;
  const shown = days.filter((day) => day >= edge);
  const older = days.filter((day) => day < edge);
  return {
    days: shown.includes(today) ? shown : [today, ...shown].sort((a, b) => b.localeCompare(a)),
    from: edge,
    next: older[Math.min(DAYS, older.length) - 1] ?? null,
  };
}
