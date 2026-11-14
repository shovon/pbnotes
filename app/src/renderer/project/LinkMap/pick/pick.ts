/**
 * What is under the pointer: the innermost bubble that shows there. Pure,
 * over the simulation's last known positions.
 */
import type { Camera, Size } from '../camera/camera.ts';
import { toScreen } from '../camera/camera.ts';
import type { Flat } from '../flat/flat.ts';

/**
 * Level of detail, in pixels, shared with the shaders: a bubble opens, and
 * what is in it shows, as its radius on screen goes from `OPEN_LOW` to
 * `OPEN_HIGH`. Zoomed out past that it is a dot, never smaller than `MIN_*`.
 */
export const OPEN_LOW = 14;
export const OPEN_HIGH = 30;
export const OPEN = (OPEN_LOW + OPEN_HIGH) / 2;
export const MIN_PAGE = 2.5;
export const MIN_BLOCK = 1.2;
/** An open bubble this big is the ground under the pointer, not a thing to grab, but for its rim. */
export const GROUND = 160;
const RIM = 8;
/** How far outside a dot still counts as on it. */
const SLOP = 3;

export type Shape = Pick<Flat, 'pages' | 'parent' | 'sibStart' | 'sibCount' | 'childStart' | 'childCount' | 'radius'>;

/** A node's radius as drawn, in pixels. */
export function drawn(flat: Shape, camera: Camera, node: number): number {
  return Math.max(flat.radius[node] * camera.zoom, flat.parent[node] < 0 ? MIN_PAGE : MIN_BLOCK);
}

/** Whether a node shows what is in it. */
export function isOpen(flat: Shape, camera: Camera, node: number): boolean {
  return flat.childCount[node] > 0 && flat.radius[node] * camera.zoom >= OPEN;
}

export type Hit = {
  node: number;
  /** On a bubble too big to grab, away from its rim: a press here pans. */
  ground: boolean;
};

/**
 * The innermost node showing at a screen point, or undefined over nothing.
 * `state` is four numbers a node, x and y first.
 */
export function pick(
  flat: Shape,
  state: Float32Array,
  camera: Camera,
  size: Size,
  sx: number,
  sy: number,
): Hit | undefined {
  const within = (start: number, count: number): Hit | undefined => {
    // Later is drawn on top.
    for (let node = start + count - 1; node >= start; node--) {
      const [x, y] = toScreen(camera, size, state[node * 4], state[node * 4 + 1]);
      const r = drawn(flat, camera, node);
      const away = Math.hypot(sx - x, sy - y);
      if (away > r + SLOP) continue;
      if (!isOpen(flat, camera, node)) return { node, ground: false };
      return (
        within(flat.childStart[node], flat.childCount[node]) ?? {
          node,
          ground: r > GROUND && away < r - RIM,
        }
      );
    }
    return undefined;
  };
  return within(0, flat.pages);
}
