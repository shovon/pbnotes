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
  shownOrder,
} from "@pbnotes/graph";
import type { Block, Page, Graph } from "@pbnotes/graph";
import type { Place, PlaceView } from "../../../../../shared/graph.ts";

/** How many more days with something on them a journal reads at a time (#282). */
export const DAYS = 10;

/** How many more pages of linked references a page reads at a time, at most (#285). */
export const CUTS = 20;

/** The blocks at which a chunk of linked references stops early, once it has a page (#285). */
export const CUT_BLOCKS = 200;

/**
 * Everything that shows at `place`: the one page, or with no place the
 * journal, each with what links to it, and what every ref on them quotes,
 * labelled with `version`. Read in one turn, so the label and the content
 * cannot disagree.
 *
 * Each view loads one list a chunk at a time, through `through`, and says
 * which `through` it read and the one that reads a chunk more (`list`):
 *
 * - **The journal's days** (#282): every day on or after `through`, a date,
 *   so a day arriving above it (today rolling over, another device's day)
 *   is added at the top and none falls off the bottom. With none, the newest
 *   `DAYS` days with something on them. Only the days in it are read for
 *   what links to them.
 * - **A page's linked references** (#285): every page that links to it, in
 *   the order they are listed, up to and including the one titled
 *   `through`. With none, no page at all, so the page's own blocks draw
 *   first and the window asks for references once it has scrolled to their
 *   end. Each chunk is `CUTS` pages, or fewer once it reaches `CUT_BLOCKS`
 *   blocks. `links` counts every block that links here, loaded or not.
 *
 * Today is in the journal whether or not it has been written on: it is the
 * day the user is about to type in, so the window always reaches it. Handed
 * in, because which day that is belongs to the clock and not to the log.
 * Sorted again only when it is added, and only because a day dated later
 * than today can exist — another machine with a fast clock, or a folder that
 * travelled backwards across a date line.
 *
 * An empty today is asked what links to it too: other days can name it. Not
 * under a zoom, where what links to the page is not about the block showing,
 * and so there is no list. Every page carries its properties, under a zoom
 * too: whether to draw them is the window's. Its tags and what tags it are
 * left out under a zoom, as what links to it is: the zoom shows a block, not
 * the page.
 */
export function getView(
  view: { readonly state: Graph; readonly version: number },
  at: Place | undefined,
  today: string,
  through?: string,
): PlaceView {
  const { state, version } = view;
  const journal = at ? undefined : days(getDays(state), today, through);
  const pages: Page[] = at
    ? [getPage(state, at.page)]
    : (journal?.days ?? []).map((day) => ({ title: day, blocks: blocksOn(state, day) }));
  // A page's own view reads its references in chunks; a journal day, whole.
  const chunked = at && !at.block ? cuts(getReferences(state, at.page), through) : undefined;
  const showing = pages.map((page) => {
    const all = at?.block ? [] : chunked?.all ?? getReferences(state, page.title);
    return {
      page,
      references: chunked?.shown ?? all,
      links: all.reduce((n, cut) => n + cut.blocks.length, 0),
      properties: getProperties(state, page.title),
      tags: at?.block ? [] : getTags(state, page.title),
      taggedBy: at?.block ? [] : getTaggedBy(state, page.title),
      deletions: getDeletions(state, page.title),
      refsTo: at && !at.block ? getRefsTo(state, page.title) : 0,
    };
  });
  const list = journal ?? chunked;
  return {
    version,
    showing,
    previews: getPreviews(state, showing.flatMap((it) => [it.page, ...it.references])),
    ...(list ? { list: { through: list.through, next: list.next } } : {}),
  };
}

/**
 * Which of `days` (newest first) the journal shows: those on or after
 * `from`, or the newest `DAYS` without one, always reaching `today`, and
 * today among them. `next` is the `from` that shows `DAYS` more, or null
 * when nothing is older.
 */
function days(all: readonly string[], today: string, from: string | undefined) {
  const start = from ?? all[Math.min(DAYS, all.length) - 1] ?? today;
  const edge = start < today ? start : today;
  const shown = all.filter((day) => day >= edge);
  const older = all.filter((day) => day < edge);
  return {
    days: shown.includes(today) ? shown : [today, ...shown].sort((a, b) => b.localeCompare(a)),
    through: edge,
    next: older[Math.min(DAYS, older.length) - 1] ?? null,
  };
}

/**
 * Which of a page's linked references (`all`, in `shownOrder`) it shows:
 * every one up to and including the page titled `through`, even once that
 * page has stopped linking here, or none without one. `through` comes back
 * as it was asked, or null when nothing was; `next` is the `through` that
 * shows one chunk more, or null when every one shows.
 */
function cuts(all: Page[], through: string | undefined) {
  const after = through === undefined ? 0 : all.findIndex((cut) => shownOrder(cut.title, through) > 0);
  const end = after === -1 ? all.length : after;
  const last = end + chunk(all.slice(end)) - 1;
  return {
    all,
    shown: all.slice(0, end),
    through: through ?? null,
    next: last >= end ? all[last].title : null,
  };
}

/** How many of `cuts`, from the first, the next chunk holds: `CUTS` at most, fewer once they hold `CUT_BLOCKS` blocks, never none of some. */
function chunk(cuts: readonly Page[]): number {
  let blocks = 0;
  for (let i = 0; i < Math.min(CUTS, cuts.length); i++) {
    blocks += size(cuts[i].blocks);
    if (blocks >= CUT_BLOCKS) return i + 1;
  }
  return Math.min(CUTS, cuts.length);
}

/** The blocks in `blocks`, at every depth. */
const size = (blocks: readonly Block[]): number => blocks.reduce((n, it) => n + 1 + size(it.children), 0);
