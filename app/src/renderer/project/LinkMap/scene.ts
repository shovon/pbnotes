/// <reference types="@webgpu/types" />
/**
 * The graph view as it runs: the camera, what the pointer and the wheel do,
 * the frame loop, and the page titles, which are drawn over the WebGPU
 * canvas on a 2D one. Frames stop once nothing is moving, and start again on
 * any input.
 */
import { ease, fit, panBy, toScreen, toWorld, zoomAt } from './camera/camera';
import type { Camera, Size } from './camera/camera';
import { place } from './flat/flat';
import type { Flat } from './flat/flat';
import { createGpu } from './gpu';
import { homes } from './grid/grid';
import type { Layout, Rank } from './grid/grid';
import { groups } from './groups/groups';
import type { Groups } from './groups/groups';
import type { Colors, Gpu, Rgb } from './gpu';
import { OPEN_HIGH, drawn, pick } from './pick/pick';
import type { Keys } from '../opening/opening';

/** What is kept of a view once it is gone, so coming back finds it as it was left. */
export type Kept = {
  /** Where the user left the camera; undefined if they never moved it, so it still follows the map. */
  camera?: Camera;
  /** Where every bubble seen so far sat, by id: one left out of the map for a while comes back to its place. */
  at: Map<string, [number, number]>;
  /** Whether the journal's days show (`LinkMap.tsx`); undefined is that they do. */
  days?: boolean;
  /** Whether blocks show in their pages; undefined is that they do. */
  blocks?: boolean;
  /** How the map is laid out; undefined is by its forces. */
  layout?: Layout;
  /** What the grid ranks pages by; undefined is every arrow that touches them. */
  rank?: Rank;
};

/** A bubble: a page, or a block on it. */
export type Target = { page: string; block?: string };

export type Scene = {
  /** A map to show: nodes it had already stay where they were. */
  setData(flat: Flat): void;
  /**
   * Whether blocks show: on, a bubble opens as it grows; off, every page is
   * one node at any zoom, shrunk to a dot with no room kept for what is in
   * it, and every arrow runs page to page. The map lays itself out again
   * around the pages' new sizes.
   */
  setBlocks(on: boolean): void;
  /**
   * How the map is laid out: by its forces, or as a grid with the most
   * linked page top left and the least bottom right, where each page is
   * sprung hard to its cell and nothing else lays it out.
   */
  setLayout(layout: Layout): void;
  /** What the grid ranks pages by: laid out as the grid, each page springs to its new cell. */
  setRank(rank: Rank): void;
  dispose(): void;
};

type Options = {
  gpu: GPU | undefined;
  /** Takes the pointer and the wheel, and is what the canvases fill. */
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  labels: HTMLCanvasElement;
  kept: { current: Kept | null };
  /** What the pointer is over, and where it is in the window; null over nothing or mid-drag. */
  onHover: (target: Target | null, at: { x: number; y: number }) => void;
  /** A bubble was clicked, not dragged. */
  onPick: (target: Target, keys: Keys) => void;
  onLost: (why: string) => void;
};

/** How far the pointer moves before a press is a drag, in pixels. */
const SLACK = 4;
/** How long one physics step stands for, so a faster display does not run a faster world. */
const STEP_MS = 1000 / 120;
/** At most this many steps a frame, however late the frame. */
const MAX_STEPS = 8;
/** How many times faster a fresh map runs while it spreads out, and for how many steps. */
const WARM_SPEED = 3;
const WARM_STEPS = 540;
/** Nothing moved further than this, in world units, between this many reads in a row: at rest. */
const STILL = 0.03;
const CALM_FRAMES = 30;
/** What the layout's heat is multiplied by each step, and held at while a bubble is dragged. */
const COOLING = 0.996;
const DRAG_HEAT = 0.3;
const MAX_LABELS = 300;
/**
 * How long the pointer rests on a bubble before the map lights it up and
 * says what it is: lighting one dims every arrow that is not its own, and a
 * pointer crossing a dense map would flash the whole view. It is let go as
 * soon as the pointer leaves it. And how long the lighting takes to fade in
 * or out, to within a third of the way.
 */
const SETTLE_MS = 300;
const FADE_MS = 90;
const TAG: Rgb = [0.66, 0.47, 0.93];
/** What the physics is told of the clusters on a frame that does not step it. */
const RESTING: Groups = { days: { x: 0, y: 0 }, apart: { x: 0, y: 0 }, share: 0 };

/** Undefined where there is no WebGPU. */
export async function createScene(options: Options): Promise<Scene | undefined> {
  const { host, canvas, labels, kept, onHover, onPick } = options;
  const pen = labels.getContext('2d');
  // Where positions land when they are read back, and so what picking and the titles read.
  let state: Float32Array = new Float32Array(0);
  /** `state` as it was read the time before. */
  let last: Float32Array = new Float32Array(0);
  let stale = true;
  const made = await createGpu(
    options.gpu,
    canvas,
    () => {
      stale = true;
      kick();
    },
    options.onLost,
  );
  if (!made || !pen) return undefined;
  const gpu: Gpu = made;

  let flat: Flat | null = null;
  let camera: Camera = kept.current?.camera ?? { x: 0, y: 0, zoom: 1 };
  /** Whether the camera is the user's: until it is, it follows the whole map. */
  let touched = kept.current?.camera !== undefined;
  let size: Size = { width: 1, height: 1 };
  let colors = readColors(host);
  let background = getComputedStyle(host).backgroundColor;

  /** What the pointer is over now: what a click takes, and what the cursor shows. */
  let hover = -1;
  /** What it was last seen over, and since when: `lit` follows it once it has stayed `SETTLE_MS`. */
  let resting = { node: -1, since: 0 };
  /** The bubble lit up, with its tooltip: -1 for none. */
  let lit = -1;
  /** The last bubble lit, kept while it fades out, and how far lit it is. */
  let shown = -1;
  let glow = 0;
  /** Whether blocks show, and how far they have faded in or out. */
  let blocks = kept.current?.blocks ?? true;
  let blocksShown = blocks ? 1 : 0;
  let layout: Layout = kept.current?.layout ?? 'force';
  let rank: Rank = kept.current?.rank ?? 'links';
  /** The map as it was loaded: `flat` has the pages' radii as they are now, between compact and full. */
  let loaded: Flat | null = null;
  let sized = -1;
  /** The grid's cells, for the pages as big as they are to be, in a grid the shape of the view. */
  const setHomes = () => {
    if (!loaded || layout !== 'grid') return;
    gpu.setHomes(homes(loaded, blocks ? loaded.radius : loaded.compact, size.width / size.height, rank));
  };
  /** Each page as big as it is with the blocks showing this far, for what the CPU does with sizes. */
  const sizePages = () => {
    if (!flat || !loaded || sized === blocksShown) return;
    sized = blocksShown;
    for (let i = 0; i < flat.pages; i++) {
      flat.radius[i] = loaded.compact[i] + (loaded.radius[i] - loaded.compact[i]) * blocksShown;
    }
  };
  let drawnAt = 0;
  let told = { x: 0, y: 0 };
  let pointer: { x: number; y: number; client: { x: number; y: number } } | null = null;
  let press:
    | { kind: 'pan'; x: number; y: number; moved: boolean; vx: number; vy: number; at: number }
    | { kind: 'node'; node: number; x: number; y: number; moved: boolean; dx: number; dy: number }
    | null = null;
  let glide: { vx: number; vy: number } | null = null;
  let awake = false;
  let calm = 0;
  let warm = 0;
  let heat = 0;
  let stepped = 0;
  let frame = 0;
  let disposed = false;

  function kick() {
    if (frame === 0 && !disposed) frame = requestAnimationFrame(tick);
  }

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    size = { width: Math.max(host.clientWidth, 1), height: Math.max(host.clientHeight, 1) };
    for (const it of [canvas, labels]) {
      it.width = Math.round(size.width * ratio);
      it.height = Math.round(size.height * ratio);
    }
    kick();
  };
  const watcher = new ResizeObserver(resize);
  watcher.observe(host);
  resize();

  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const recolor = () => {
    colors = readColors(host);
    background = getComputedStyle(host).backgroundColor;
    kick();
  };
  scheme.addEventListener('change', recolor);

  /** The box around every page, or undefined with none. */
  const bounds = () => {
    if (!flat || flat.pages === 0) return undefined;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (let i = 0; i < flat.pages; i++) {
      const r = flat.radius[i];
      box.left = Math.min(box.left, state[i * 4] - r);
      box.right = Math.max(box.right, state[i * 4] + r);
      box.top = Math.min(box.top, state[i * 4 + 1] - r);
      box.bottom = Math.max(box.bottom, state[i * 4 + 1] + r);
    }
    return box;
  };

  const targetOf = (map: Flat, node: number): Target => ({ page: map.titles[node], block: map.blocks[node] });

  const point = (event: { clientX: number; clientY: number }) => {
    const box = host.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, client: { x: event.clientX, y: event.clientY } };
  };

  /** What is under the pointer, and what is lit up; true while either is still settling. */
  const rehover = (now: number): boolean => {
    const hit = flat && pointer && !press ? pick(flat, state, camera, size, pointer.x, pointer.y, blocks) : undefined;
    hover = hit && !hit.ground ? hit.node : -1;
    host.style.cursor = press?.kind === 'pan' && press.moved ? 'grabbing' : hover >= 0 ? 'pointer' : 'default';

    // A bubble being dragged is lit at once; anything else once the pointer has rested there.
    const held = press?.kind === 'node' ? press.node : -1;
    const wanted = held >= 0 ? held : hover;
    if (wanted !== resting.node) resting = { node: wanted, since: now };
    const before = lit;
    // Let go as soon as the pointer is off it, and lit once the pointer has stayed.
    if (wanted !== lit) lit = -1;
    if (wanted >= 0 && (held >= 0 || now - resting.since >= SETTLE_MS)) lit = wanted;
    if (lit >= 0) shown = lit;
    const to = lit >= 0 ? 1 : 0;
    glow += (to - glow) * (1 - Math.exp(-(now - drawnAt) / FADE_MS));
    if (Math.abs(to - glow) < 0.01) glow = to;
    if (glow === 0) shown = -1;
    const all = blocks ? 1 : 0;
    blocksShown += (all - blocksShown) * (1 - Math.exp(-(now - drawnAt) / FADE_MS));
    if (Math.abs(all - blocksShown) < 0.01) blocksShown = all;
    sizePages();
    drawnAt = now;

    const at = pointer?.client ?? { x: 0, y: 0 };
    // Told when it changes, and as the pointer moves over it, never every frame. Nothing is
    // said of a bubble while it is dragged.
    const say = lit >= 0 && held < 0 ? lit : -1;
    if (!(lit === before && (say < 0 || (at.x === told.x && at.y === told.y)))) {
      told = at;
      onHover(flat && say >= 0 ? targetOf(flat, say) : null, at);
    }
    return lit !== wanted || glow !== to || blocksShown !== all;
  };

  const onDown = (event: PointerEvent) => {
    // A press on what sits over the map, its controls, is theirs.
    if (event.button !== 0 || !flat || event.target !== canvas) return;
    const at = point(event);
    pointer = at;
    glide = null;
    touched = true;
    const hit = pick(flat, state, camera, size, at.x, at.y, blocks);
    if (hit && !hit.ground) {
      const [wx, wy] = toWorld(camera, size, at.x, at.y);
      press = {
        kind: 'node',
        node: hit.node,
        x: at.x,
        y: at.y,
        moved: false,
        // Held where it was caught, not by its middle.
        dx: state[hit.node * 4] - wx,
        dy: state[hit.node * 4 + 1] - wy,
      };
    } else {
      press = { kind: 'pan', x: at.x, y: at.y, moved: false, vx: 0, vy: 0, at: event.timeStamp };
    }
    host.setPointerCapture(event.pointerId);
    kick();
  };

  const onMove = (event: PointerEvent) => {
    if (!press && event.target !== canvas) {
      // Over a control, the pointer is over no bubble.
      pointer = null;
      kick();
      return;
    }
    const at = point(event);
    const last = pointer;
    pointer = at;
    if (press && !press.moved && Math.hypot(at.x - press.x, at.y - press.y) > SLACK) {
      press.moved = true;
      onHover(null, at.client);
    }
    if (press?.kind === 'pan' && press.moved && last) {
      const dx = at.x - last.x;
      const dy = at.y - last.y;
      camera = panBy(camera, dx, dy);
      // What it was moving at lately, for letting go mid-swipe.
      const elapsed = Math.max(event.timeStamp - press.at, 1);
      press.vx = press.vx * 0.5 + ((dx / elapsed) * 16) * 0.5;
      press.vy = press.vy * 0.5 + ((dy / elapsed) * 16) * 0.5;
      press.at = event.timeStamp;
    }
    if (press?.kind === 'node' && press.moved) awake = true;
    kick();
  };

  const onUp = (event: PointerEvent) => {
    const was = press;
    press = null;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    if (!was) return;
    if (was.kind === 'node' && !was.moved && flat) onPick(targetOf(flat, was.node), event);
    if (was.kind === 'pan' && was.moved && event.timeStamp - was.at < 60 && Math.hypot(was.vx, was.vy) > 1) {
      glide = { vx: was.vx, vy: was.vy };
    }
    kick();
  };

  const onLeave = () => {
    if (press) return;
    pointer = null;
    kick();
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const at = point(event);
    pointer = at;
    touched = true;
    glide = null;
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    if (event.ctrlKey) {
      // A pinch arrives as a wheel with Ctrl held, a little at a time; a
      // real wheel a notch at a time, which is held to a step that reads as one.
      const by = Math.max(-24, Math.min(24, event.deltaY * lines));
      camera = zoomAt(camera, size, at.x, at.y, Math.exp(-by * 0.01));
    } else {
      camera = panBy(camera, -event.deltaX * lines, -event.deltaY * lines);
    }
    kick();
  };

  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  host.addEventListener('pointerleave', onLeave);
  host.addEventListener('wheel', onWheel, { passive: false });

  const widths = new Map<string, number>();

  const drawLabels = () => {
    const ratio = labels.width / size.width;
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    pen.clearRect(0, 0, size.width, size.height);
    const map = flat;
    if (!map) return;
    const shown: { node: number; x: number; y: number; r: number }[] = [];
    for (let node = 0; node < map.pages; node++) {
      const [x, y] = toScreen(camera, size, state[node * 4], state[node * 4 + 1]);
      const r = drawn(flat, camera, node);
      if (x + r < -80 || x - r > size.width + 80 || y + r < -20 || y - r > size.height + 20) continue;
      shown.push({ node, x, y, r });
    }
    // The biggest first: they are named even as dots, and get their room before the rest.
    shown.sort((a, b) => map.radius[b.node] - map.radius[a.node] || a.node - b.node);
    const taken: { left: number; top: number; right: number; bottom: number }[] = [];
    pen.textAlign = 'center';
    pen.textBaseline = 'alphabetic';
    pen.lineJoin = 'round';
    pen.lineWidth = 3;
    pen.strokeStyle = background;
    let named = 0;
    for (let rank = 0; rank < shown.length && named < MAX_LABELS; rank++) {
      const { node, x, y, r } = shown[rank];
      if (r < 6 && rank >= 40 && node !== lit) continue;
      const open = blocks && map.childCount[node] > 0 && map.radius[node] * camera.zoom >= OPEN_HIGH;
      const title = map.titles[node];
      const text = title.length > 34 ? `${title.slice(0, 33)}…` : title;
      const font = open ? '600 12px system-ui, sans-serif' : '500 11px system-ui, sans-serif';
      pen.font = font;
      const key = `${font}|${text}`;
      const width = widths.get(key) ?? pen.measureText(text).width;
      widths.set(key, width);
      // An open bubble is named over its rim, or at the top of the view once the rim is past it.
      const baseline = open ? Math.max(y - r - 5, Math.min(16, y + r - 6)) : y + r + 12;
      // And kept in the view, when its middle is off to one side.
      const middle = open ? Math.min(Math.max(x, width / 2 + 8), Math.max(size.width - width / 2 - 8, width / 2 + 8)) : x;
      const box = { left: middle - width / 2 - 2, right: middle + width / 2 + 2, top: baseline - 11, bottom: baseline + 3 };
      if (taken.some((it) => it.left < box.right && box.left < it.right && it.top < box.bottom && box.top < it.bottom)) {
        continue;
      }
      taken.push(box);
      named++;
      const color = node === lit ? colors.accent : map.childCount[node] === 0 ? colors.muted : colors.fg;
      pen.fillStyle = `rgb(${color.map((it) => Math.round(it * 255)).join(' ')})`;
      pen.strokeText(text, middle, baseline);
      pen.fillText(text, middle, baseline);
    }
  };

  function tick() {
    frame = 0;
    if (disposed) return;
    let again = false;

    if (stale) {
      stale = false;
      // At rest once nothing has moved to speak of for a while.
      // By how far things moved since they were last read, not by their speed: a bubble
      // leaning on its neighbour is pushed back each step as fast as it falls in.
      let fastest = 0;
      for (let i = 0; i < state.length; i += 4) {
        fastest = Math.max(fastest, Math.abs(state[i] - last[i]), Math.abs(state[i + 1] - last[i + 1]));
      }
      last.set(state);
      calm = fastest < STILL ? calm + 1 : 0;
      if (calm > CALM_FRAMES && (heat === 0 || layout === 'grid') && press?.kind !== 'node') awake = false;
    }

    if (glide) {
      camera = panBy(camera, glide.vx, glide.vy);
      glide = { vx: glide.vx * 0.92, vy: glide.vy * 0.92 };
      if (Math.hypot(glide.vx, glide.vy) < 0.2) glide = null;
      else again = true;
    }

    if (!touched) {
      const box = bounds();
      if (box) {
        const whole = fit(box, size);
        const far =
          Math.abs(Math.log(whole.zoom / camera.zoom)) > 0.002 ||
          Math.hypot(whole.x - camera.x, whole.y - camera.y) * camera.zoom > 0.5;
        if (far) {
          camera = ease(camera, whole, 0.14);
          again = true;
        }
      }
    }

    const now = performance.now();
    if (rehover(now)) again = true;

    let drag = null;
    if (press?.kind === 'node' && press.moved && pointer) {
      const [x, y] = toWorld(camera, size, pointer.x, pointer.y);
      drag = { node: press.node, x: x + press.dx, y: y + press.dy };
    }
    const due = Math.max(1, Math.round((now - stepped) / STEP_MS)) * (warm > 0 ? WARM_SPEED : 1);
    const steps = awake ? Math.min(MAX_STEPS, due) : 0;
    stepped = now;
    warm = Math.max(0, warm - steps);
    // The grid is laid out by its cells alone: no heat, whatever is dragged.
    const grid = layout === 'grid';
    if (drag && !grid) heat = Math.max(heat, DRAG_HEAT);
    const clusters = flat && steps > 0 && !grid ? groups(flat, state) : RESTING;
    gpu.frame({
      camera,
      size,
      colors,
      hover: shown,
      glow,
      blocks: blocksShown,
      grid,
      drag,
      steps,
      heat: grid ? 0 : heat,
      groups: clusters,
    });
    heat *= COOLING ** steps;
    if (heat < 0.005) heat = 0;
    drawLabels();

    if (awake || again) kick();
  }

  /** Where every node seen so far sat, by id, the ones showing now as they are now. */
  const memory = new Map(kept.current?.at);
  const places = () => {
    if (flat) for (let i = 0; i < flat.count; i++) memory.set(flat.ids[i], [state[i * 4], state[i * 4 + 1]]);
    return memory;
  };

  return {
    setData(next) {
      const known = places();
      const fresh = known.size === 0;
      warm = fresh ? WARM_STEPS : 0;
      // A map seen before only has what is new to make room for, and one with nothing new stays put.
      const grown = !fresh && next.ids.some((id) => !known.has(id));
      heat = fresh ? 1 : grown ? DRAG_HEAT : 0;
      // Its own copy of the radii: the pages' change as the blocks come and go.
      loaded = next;
      flat = { ...next, radius: next.radius.slice() };
      sized = -1;
      sizePages();
      state = place(next, known);
      last = state.slice();
      // What was lit is another map's node now.
      hover = -1;
      resting = { node: -1, since: 0 };
      lit = -1;
      shown = -1;
      glow = 0;
      press = null;
      gpu.load(next, state);
      setHomes();
      awake = true;
      calm = 0;
      stale = false;
      kick();
    },
    setBlocks(on) {
      if (on === blocks) return;
      blocks = on;
      // The pages are other sizes now: the map finds its shape again, from where it is,
      // and the grid's cells are other sizes too. It is another map to look at: all of it.
      heat = 1;
      setHomes();
      touched = false;
      awake = true;
      calm = 0;
      kick();
    },
    setLayout(next) {
      if (next === layout) return;
      layout = next;
      // Into the grid, every page goes to its cell; out of it, the forces take the map
      // from where the grid left it. Either way it is another map to look at: all of it.
      setHomes();
      heat = 1;
      warm = 0;
      touched = false;
      awake = true;
      calm = 0;
      kick();
    },
    setRank(next) {
      if (next === rank) return;
      rank = next;
      setHomes();
      awake = true;
      calm = 0;
      kick();
    },
    dispose() {
      disposed = true;
      // Nothing loaded is nothing to keep: what was kept before stands.
      if (flat) kept.current = { ...kept.current, camera: touched ? camera : undefined, at: places() };
      cancelAnimationFrame(frame);
      watcher.disconnect();
      scheme.removeEventListener('change', recolor);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('wheel', onWheel);
      gpu.destroy();
    },
  };
}

/** The theme's colours as the shaders take them, read off the element's own CSS variables. */
function readColors(host: HTMLElement): Colors {
  const pen = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const style = getComputedStyle(host);
  const read = (name: string, fallback: Rgb): Rgb => {
    const value = style.getPropertyValue(name).trim();
    if (!pen || !value) return fallback;
    pen.clearRect(0, 0, 1, 1);
    pen.fillStyle = value;
    pen.fillRect(0, 0, 1, 1);
    const [r, g, b] = pen.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  };
  return {
    fg: read('--color-fg', [0.1, 0.1, 0.1]),
    muted: read('--color-muted', [0.5, 0.5, 0.5]),
    accent: read('--color-accent', [0.2, 0.4, 0.9]),
    tag: TAG,
  };
}
