/**
 * The map's two clusters (an experiment): the journal's days, and every
 * other page. Each frame this says where the days' middle is, which they are
 * drawn to (`DAY_PULL` in `shaders.ts`), and how hard the two clusters are to
 * be pushed apart, or drawn back together: they are held with a strip of
 * clear ground between them, side by side. Pure, over the positions as they
 * were last read.
 */
import type { Flat } from '../flat/flat.ts';

/** Clear ground kept between the two clusters, in world units. */
const MARGIN = 60;
/** The hardest the two are pushed apart or drawn together, and how far off that strip they are before it is that hard. */
const MOST = 4;
const RAMP = 40;

export type Groups = {
  /** The middle of the journal's days. */
  days: { x: number; y: number };
  /** The push on the days, away from the other pages or back toward them; the other pages get it the other way. */
  apart: { x: number; y: number };
  /** How much of the push the other pages take: the fewer they are, the more. */
  share: number;
};

const NONE: Groups = { days: { x: 0, y: 0 }, apart: { x: 0, y: 0 }, share: 0 };

/** `state` is four numbers a node, x and y first. */
export function groups(flat: Pick<Flat, 'pages' | 'day' | 'radius'>, state: Float32Array): Groups {
  /** A cluster as a disc: its middle, and how far it reaches. */
  const disc = (day: number) => {
    let n = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < flat.pages; i++) {
      if (flat.day[i] !== day) continue;
      n++;
      x += state[i * 4];
      y += state[i * 4 + 1];
    }
    if (n === 0) return undefined;
    x /= n;
    y /= n;
    // As far as its furthest page's far side: an average falls short of the big bubbles at the edge.
    let reach = 0;
    for (let i = 0; i < flat.pages; i++) {
      if (flat.day[i] !== day) continue;
      reach = Math.max(reach, Math.hypot(state[i * 4] - x, state[i * 4 + 1] - y) + flat.radius[i]);
    }
    return { n, x, y, reach };
  };
  const days = disc(1);
  const rest = disc(0);
  if (!days) return NONE;
  if (!rest) return { ...NONE, days: { x: days.x, y: days.y } };

  const dx = days.x - rest.x;
  const dy = days.y - rest.y;
  const between = Math.hypot(dx, dy);
  const short = rest.reach + days.reach + MARGIN - between;
  const push = MOST * Math.max(-1, Math.min(short / RAMP, 1));
  // On top of each other, as a fresh map's are: the days go right.
  const way = between < 0.001 ? { x: 1, y: 0 } : { x: dx / between, y: dy / between };
  return {
    days: { x: days.x, y: days.y },
    apart: { x: way.x * push, y: way.y * push },
    share: days.n / (days.n + rest.n),
  };
}
