/**
 * When a window asks main for what shows at its place, and which answer it
 * keeps. It asks on every move, and on hearing the fold reached a version
 * the view it holds lacks, unless a fetch already on its way covers it.
 *
 * Built from what it reaches outside, so a test can hand it a fake `view`
 * whose answers arrive late, out of order, or not at all. `ProjectView`
 * binds the bridge and the clock, and wires the rest.
 */
import type { Place, PlaceView } from '../../../shared/pages.ts';
import { keep, samePlace } from '../held/held.ts';
import type { Held } from '../held/held.ts';

export type FetcherPorts = {
  /** Asks main what shows at a place. */
  view: (place: Place | undefined) => Promise<PlaceView>;
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
};

export function createFetcher({ view, where, onAnswer, onError }: FetcherPorts): Fetcher {
  let held: Held | null = null;
  /** The highest fold version heard of. */
  let known = 0;
  /** The highest version a fetch already asked for is sure to reach. */
  let covered = 0;

  /**
   * Main reads the fold when it answers, so the answer holds every version
   * heard of by now. An answer that lands after the window has moved on, or
   * behind one already held, is dropped (`held/`).
   */
  const ask = () => {
    const at = where();
    covered = known;
    view(at).then(
      (answer) => {
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
    moved: ask,
    heard: (v) => {
      known = Math.max(known, v);
      if (held && samePlace(held.place, where()) && held.view.version >= v) return;
      if (covered >= v) return;
      ask();
    },
  };
}
