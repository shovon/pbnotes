/**
 * When a window asks main for what shows at its place, and which answer it
 * keeps. It asks on every move, and on hearing the fold reached a version
 * the view it holds lacks, unless a fetch already on its way covers it.
 *
 * It also holds how far the place's list is loaded (`PlaceView.list`): the
 * journal's days (#282), or a page's linked references (#285). Main picks
 * the first `through`, and the fetcher keeps asking for that one, so a
 * change never shrinks the list under the user's scroll; `more` moves it on
 * to the `through` main named for a chunk more. Each place starts over.
 *
 * Built from what it reaches outside, so a test can hand it a fake `view`
 * whose answers arrive late, out of order, or not at all. `Tab`
 * binds the bridge and the clock, and wires the rest.
 */
import type { Place, PlaceView } from '../../../shared/graph.ts';
import { keep, samePlace } from '../held/held.ts';
import type { Held } from '../held/held.ts';

export type FetcherPorts = {
  /** Asks main what shows at a place, its list loaded `through` a day or title. */
  view: (place: Place | undefined, through: string | undefined) => Promise<PlaceView>;
  /** The place the window is on now. */
  where: () => Place | undefined;
  /** A new view to draw. */
  onAnswer: (held: Held) => void;
  /** A fetch failed. */
  onError: (error: unknown) => void;
  /**
   * The view a tab drew last time it was shown (#303), to pick up from: the
   * answer to compare the next against, and how far its list was loaded.
   */
  start?: Held | null;
};

export type Fetcher = {
  /** The window moved, or first opened: ask for where it is now. */
  moved: () => void;
  /** The fold reached `v`: a notice from main, or a write's reply. */
  heard: (v: number) => void;
  /**
   * More of the list is wanted: the journal's older days, or a page's next
   * linked references. Asks for the chunk main said comes next; nothing
   * when all of it is loaded, or the chunk is asked for already.
   */
  more: () => void;
  /**
   * Shown again (#303): ask for where it is, with its list loaded as far as
   * the view it started from, so coming back to a tab does not shrink the
   * journal under where it was scrolled to. The same as `moved` when it
   * started from nothing, or from a view for another place.
   */
  resumed: () => void;
};

export function createFetcher({ view, where, onAnswer, onError, start = null }: FetcherPorts): Fetcher {
  let held: Held | null = start;
  /** The highest fold version heard of. */
  let known = 0;
  /** The highest version a fetch already asked for is sure to reach. */
  let covered = 0;
  /** How far the list is loaded, or undefined until main first says. */
  let through: string | undefined;

  /**
   * Main reads the fold when it answers, so the answer holds every version
   * heard of by now. An answer that lands after the window has moved on, or
   * behind one already held, is dropped (`held/`). So is one read for a
   * list loaded less far than it is now: the fetch for the longer one is on
   * its way, and when it is not (two first answers, each with a `through` of
   * main's), the newer version is asked for again over what is held.
   */
  const ask = () => {
    const at = where();
    const asked = through;
    covered = known;
    view(at, asked).then(
      (answer) => {
        const here = samePlace(at, where());
        if (here && asked === undefined && through === undefined) {
          through = answer.list?.through ?? undefined;
        } else if (here && asked !== through) {
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
      // A place's list is its own: the journal starts over at its newest
      // days, and a page at its own blocks.
      through = undefined;
      ask();
    },
    heard: (v) => {
      known = Math.max(known, v);
      if (held && samePlace(held.place, where()) && held.view.version >= v) return;
      if (covered >= v) return;
      ask();
    },
    resumed: () => {
      const from = start && samePlace(start.place, where()) ? start.view.list?.through : undefined;
      through = from ?? undefined;
      ask();
    },
    more: () => {
      const next = held && samePlace(held.place, where()) ? held.view.list?.next : undefined;
      if (!next || next === through) return;
      through = next;
      ask();
    },
  };
}
