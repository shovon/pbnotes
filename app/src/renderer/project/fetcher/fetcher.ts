/**
 * When a window asks main for what shows at its place, and which answer it
 * keeps. It asks on every move, and on hearing the fold reached a version
 * the view it holds lacks, unless a fetch already on its way covers it.
 *
 * On the journal it also holds which days to ask for (#282): every day on
 * or after `from`. Main picks the first `from`, and the fetcher keeps asking
 * for that one, so a change never shrinks the journal under the user's
 * scroll; `more` lowers it to the `from` main named for older days.
 *
 * Built from what it reaches outside, so a test can hand it a fake `view`
 * whose answers arrive late, out of order, or not at all. `ProjectView`
 * binds the bridge and the clock, and wires the rest.
 */
import type { Place, PlaceView } from '../../../shared/graph.ts';
import { keep, samePlace } from '../held/held.ts';
import type { Held } from '../held/held.ts';

export type FetcherPorts = {
  /** Asks main what shows at a place, or on the journal from `from` on. */
  view: (place: Place | undefined, from: string | undefined) => Promise<PlaceView>;
  /** The place the window is on now. */
  where: () => Place | undefined;
  /** A new view to draw. */
  onAnswer: (held: Held) => void;
  /** A fetch failed. */
  onError: (error: unknown) => void;
};

export type Fetcher = {
  /** The window moved, or first opened: ask for where it is now. */
  moved: () => void;
  /** The fold reached `v`: a notice from main, or a write's reply. */
  heard: (v: number) => void;
  /**
   * The journal's older days are wanted: ask for the ones main said come
   * next. Nothing on a page, with no older days, or with them already asked.
   */
  more: () => void;
};

export function createFetcher({ view, where, onAnswer, onError }: FetcherPorts): Fetcher {
  let held: Held | null = null;
  /** The highest fold version heard of. */
  let known = 0;
  /** The highest version a fetch already asked for is sure to reach. */
  let covered = 0;
  /** Where the journal starts, or undefined until main first says. */
  let from: string | undefined;

  /**
   * Main reads the fold when it answers, so the answer holds every version
   * heard of by now. An answer that lands after the window has moved on, or
   * behind one already held, is dropped (`held/`). So is a journal read for
   * a window since widened: the fetch for the wider one is on its way, and
   * when it is not (two first answers, each with a `from` of main's), the
   * newer version is asked for again over the window held.
   */
  const ask = () => {
    const at = where();
    const window = at ? undefined : from;
    covered = known;
    view(at, window).then(
      (answer) => {
        const journal = !at && !where();
        if (journal && from === undefined) from = answer.journal?.from;
        else if (journal && window !== from) {
          if (answer.version > (held?.view.version ?? 0)) ask();
          return;
        }
        const next = keep(held, where(), { place: at, view: answer });
        if (next === held || !next) return;
        held = next;
        onAnswer(next);
      },
      (error: unknown) => {
        covered = 0;
        onError(error);
      },
    );
  };

  return {
    moved: () => {
      // Back on the journal from elsewhere, it starts over at main's newest days.
      if (where()) from = undefined;
      ask();
    },
    heard: (v) => {
      known = Math.max(known, v);
      if (held && samePlace(held.place, where()) && held.view.version >= v) return;
      if (covered >= v) return;
      ask();
    },
    more: () => {
      const next = held && !held.place && !where() ? held.view.journal?.next : undefined;
      if (!next || (from !== undefined && next >= from)) return;
      from = next;
      ask();
    },
  };
}
