/**
 * Where the view is looking: the world point at its middle, and how many
 * pixels a world unit is. Pure. Screen points are in CSS pixels from the
 * view's top left, and both ys run down.
 */
export type Camera = { x: number; y: number; zoom: number };
export type Size = { width: number; height: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 80;

export function toScreen(camera: Camera, size: Size, x: number, y: number): [number, number] {
  return [(x - camera.x) * camera.zoom + size.width / 2, (y - camera.y) * camera.zoom + size.height / 2];
}

export function toWorld(camera: Camera, size: Size, sx: number, sy: number): [number, number] {
  return [(sx - size.width / 2) / camera.zoom + camera.x, (sy - size.height / 2) / camera.zoom + camera.y];
}

/** Zoomed by `factor` about a screen point, which stays over the same world point: a pinch. */
export function zoomAt(camera: Camera, size: Size, sx: number, sy: number, factor: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  const [wx, wy] = toWorld(camera, size, sx, sy);
  return { zoom, x: wx - (sx - size.width / 2) / zoom, y: wy - (sy - size.height / 2) / zoom };
}

/** Moved so what was under the pointer follows it `dx`, `dy` pixels. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom };
}

/** Looking at all of a box, with `margin` pixels to spare on every side. */
export function fit(
  box: { left: number; top: number; right: number; bottom: number },
  size: Size,
  margin = 48,
): Camera {
  const wide = Math.max(box.right - box.left, 1);
  const tall = Math.max(box.bottom - box.top, 1);
  const zoom = Math.min(
    Math.max(size.width - margin * 2, 1) / wide,
    Math.max(size.height - margin * 2, 1) / tall,
    // A lone page is not blown up to fill the window.
    12,
  );
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
  };
}

/** `from` moved `by` of the way to `to`, zoom by ratio so it feels even at any scale. */
export function ease(from: Camera, to: Camera, by: number): Camera {
  return {
    x: from.x + (to.x - from.x) * by,
    y: from.y + (to.y - from.y) * by,
    zoom: from.zoom * (to.zoom / from.zoom) ** by,
  };
}
