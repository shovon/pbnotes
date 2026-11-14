/**
 * The graph view's WGSL: one compute step of the physics, and the two draws.
 * Every node is one particle in world space, whatever its depth; what makes
 * a bubble hold its blocks is forces, so a drag anywhere is felt elastically
 * by everything around it.
 */
import { MIN_BLOCK, MIN_PAGE, OPEN, OPEN_HIGH, OPEN_LOW } from './pick/pick';

/** A number as WGSL takes a float. */
const f = (value: number) => value.toFixed(3);

/** As `flat.ts` packs them (`gpu.ts`): 40 bytes a node, 16 a spring. */
const STRUCTS = /* wgsl */ `
struct Node {
  parent: i32,
  sibStart: u32,
  sibCount: u32,
  childStart: u32,
  childCount: u32,
  springStart: u32,
  springCount: u32,
  radius: f32,
  /** Bit 0: a journal day's page. */
  flags: u32,
  /** A page's radius when its blocks do not show. */
  compact: f32,
}
`;

const VIEW = /* wgsl */ `
struct View {
  center: vec2f,
  size: vec2f,
  zoom: f32,
  /** The bubble lit up, or -1, and how far lit it is: 0 not at all, 1 fully. */
  hover: i32,
  glow: f32,
  /** How far the blocks show: 1 as bubbles in their pages, 0 not at all, every page one node. */
  blocks: f32,
  fg: vec4f,
  muted: vec4f,
  accent: vec4f,
  tag: vec4f,
  /** 1 when the map is laid out as the grid. */
  grid: f32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

/** A point in pixels from the view's middle, y down, as clip space has it. */
fn clip(px: vec2f) -> vec4f {
  return vec4f(px.x / (view.size.x * 0.5), -px.y / (view.size.y * 0.5), 0.0, 1.0);
}

/** A node's radius in the world: a page's shrinks to a dot as its blocks stop showing. */
fn rad(n: Node) -> f32 {
  if (n.parent < 0) { return mix(n.compact, n.radius, view.blocks); }
  return n.radius;
}

/** A node's radius as drawn: never smaller than a dot. */
fn drawn(n: Node) -> f32 {
  return max(rad(n) * view.zoom, select(${f(MIN_BLOCK)}, ${f(MIN_PAGE)}, n.parent < 0));
}
`;

/**
 * One step. Each node reads every sibling (they push apart, and pages repel
 * at a distance, which is what spreads the map), its parent (a leash to the
 * middle and a wall at the rim), its children (the same two, pushing back on
 * it) and its springs. The node under the pointer goes where the pointer is;
 * its bubble, and that bubble's, follow it as if the hand weighed more than
 * they do.
 *
 * What lays the map out (the repulsion, the springs, the pull to the middle)
 * is scaled by `heat`, which the scene cools to nothing, as d3 does its
 * alpha: some of it pushes one way only, and would turn the map for ever.
 * What keeps bubbles whole and apart is never scaled.
 *
 * Laid out as the grid there is no heat at all: each page is sprung to its
 * cell, hard, and that is the whole of the layout.
 */
export const SIM = /* wgsl */ `
${STRUCTS}
struct Spring { other: u32, kind: u32, strength: f32, rest: f32 }
struct Sim { count: u32, drag: i32, dragPos: vec2f, heat: f32, share: f32, daysAt: vec2f, apart: vec2f, blocks: f32, grid: f32 }

@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
@group(0) @binding(2) var<storage, read> springs: array<Spring>;
@group(0) @binding(3) var<storage, read> before: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> after: array<vec4f>;
/** Each page's cell in the grid layout, by its index. */
@group(0) @binding(5) var<storage, read> homes: array<vec2f>;

const DAMPING = 0.82;
const MAX_SPEED = 6.0;
const COLLIDE = 0.2;
/** How much of an overlap is undone outright each step, on top of the push. */
const APART = 0.6;
const GAP = 0.35;
const CHARGE = 1.1;
const GRAVITY = 0.012;
const CENTER = 0.6;
const WALL = 0.4;
const RIM = 0.4;
const LINK = 0.012;
const PULL = 0.02;
/** How much of its bubble's own motion a node is carried along by; the rest it catches up on. */
const INHERIT = 0.7;
/**
 * How hard a journal day is drawn to the middle of all the days, as GRAVITY draws the other
 * pages to the middle of the map: more keeps the days closer together.
 */
const DAY_PULL = 0.04;
/**
 * The grid layout: how hard a page is sprung to its cell, and how fast it may go back to it.
 * Stiff, and a little underdamped, so a page flung off its cell snaps back and settles.
 */
const HOME = 0.14;
const HOME_SPEED = 18.0;

/** A node's radius: a page's shrinks to a dot as its blocks stop showing (\`sim.blocks\` 1 to 0). */
fn rad(n: Node) -> f32 {
  if (n.parent < 0) { return mix(n.compact, n.radius, sim.blocks); }
  return n.radius;
}

/** The child of \`i\` the dragged node is, or is under; -1 for none. */
fn heldUnder(i: u32) -> i32 {
  var h = sim.drag;
  for (var k = 0; k < 32; k++) {
    if (h < 0) { return -1; }
    let above = nodes[u32(h)].parent;
    if (above == i32(i)) { return h; }
    h = above;
  }
  return -1;
}

@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= sim.count) { return; }
  let n = nodes[i];
  let s = before[i];
  var p = s.xy;
  var v = s.zw;
  let top = n.parent < 0;
  if (!top && sim.blocks < 1.0) {
    // Blocks that do not show are not simulated: each rides its page, whole, so it is
    // where it was in it when they show again.
    var page = u32(n.parent);
    for (var k = 0; k < 32; k++) {
      let above = nodes[page].parent;
      if (above < 0) { break; }
      page = u32(above);
    }
    after[i] = vec4f(p + before[page].zw, 0.0, 0.0);
    return;
  }
  let r = rad(n);
  let m = r * r;
  let day = (n.flags & 1u) != 0u;
  var a = vec2f(0.0);
  // Moved outright, not sped up: what keeps two bubbles from sitting in each other.
  var push = vec2f(0.0);
  var carried = vec2f(0.0);

  for (var k = 0u; k < n.sibCount; k++) {
    let j = n.sibStart + k;
    if (j == i) { continue; }
    let other = rad(nodes[j]);
    var d = p - before[j].xy;
    var dist = length(d);
    if (dist < 0.001) {
      // On top of each other: apart, each its own way.
      let turn = f32((i * 7919u + j * 104729u) % 6283u) * 0.001;
      d = vec2f(cos(turn), sin(turn)) * 0.001;
      dist = 0.001;
    }
    let dir = d / dist;
    let reach = r + other + GAP;
    if (dist < reach) {
      // The smaller of two gives way more.
      let share = other * other / (m + other * other);
      a += dir * (reach - dist) * COLLIDE * 2.0 * share;
      push += dir * (reach - dist) * APART * share;
      // And it stops closing in: many springs pulling one way add up, and a push alone loses to them.
      let closing = dot(v - before[j].zw, dir);
      if (closing < 0.0) { v -= dir * closing * share; }
    }
    // Pages spread out among their own kind: the days among the days, the rest among the
    // rest. Where the two clusters sit beside each other is for one spring to say (groups/).
    if (top && day == ((nodes[j].flags & 1u) != 0u)) {
      a += dir * sim.heat * CHARGE * (other + 1.0) / (max(dist - r - other, 0.0) + 6.0);
    }
  }

  if (top) {
    // Laid out as the grid, a page has a cell and one spring to it, and nothing else lays it
    // out: the scene sends no heat. It still keeps off what it touches, so one dragged through
    // the others shoves them, and they spring back.
    if (sim.grid > 0.5) { a += (homes[i] - p) * HOME; }
    if (day) {
      // A journal day is drawn to the middle of all the days, not of the map.
      a += (sim.daysAt - p) * DAY_PULL * sim.heat;
      // And the days and the other pages are two clusters, pushed apart as wholes (groups/).
      a += sim.apart * (1.0 - sim.share) * sim.heat;
    } else {
      a -= p * GRAVITY * sim.heat;
      a -= sim.apart * sim.share * sim.heat;
    }
  } else {
    let above = nodes[u32(n.parent)];
    let its = before[u32(n.parent)];
    let d = p - its.xy;
    let dist = length(d);
    let room = rad(above);
    a -= d * CENTER / (room * room);
    let limit = max(room - r - RIM, 0.0);
    if (dist > limit) {
      a -= d / dist * (dist - limit) * WALL;
      push -= d / dist * (dist - limit) * APART;
    }
    // Carried along by every bubble it is in, each a little less than the one inside it.
    var up = n.parent;
    var part = INHERIT;
    for (var k = 0; k < 32; k++) {
      if (up < 0) { break; }
      carried += before[u32(up)].zw * part;
      part *= INHERIT;
      up = nodes[u32(up)].parent;
    }
  }

  let held = heldUnder(i);
  // What it holds pushes back on it only while it is simulated.
  let inside = select(0u, n.childCount, sim.blocks >= 1.0);
  for (var k = 0u; k < inside; k++) {
    let c = n.childStart + k;
    let cr = nodes[c].radius;
    let d = before[c].xy - p;
    let dist = length(d);
    let limit = max(r - cr - RIM, 0.0);
    var wall = vec2f(0.0);
    if (dist > limit) { wall = d / dist * (dist - limit) * WALL; }
    if (i32(c) == held) {
      a += wall;
    } else {
      a += (wall + d * CENTER / m) * (cr * cr / m);
    }
  }

  for (var k = 0u; k < n.springCount; k++) {
    let spring = springs[n.springStart + k];
    let d = before[spring.other].xy - p;
    let dist = max(length(d), 0.001);
    if (spring.kind == 0u) {
      // At rest a little apart, however big the two are just now.
      let rest = r + rad(nodes[spring.other]) + spring.rest;
      a += d / dist * clamp(dist - rest, -20.0, 20.0) * spring.strength * LINK * sim.heat;
    } else {
      a += d / dist * PULL * spring.strength * sim.heat;
    }
  }

  v = (v + a) * DAMPING;
  let speed = length(v);
  let most = select(MAX_SPEED, HOME_SPEED, top && sim.grid > 0.5);
  if (speed > most) { v *= most / speed; }
  // What it moved by of its own accord is what it is moving at: a bubble held
  // still by its neighbours is still, and carries nothing along.
  v += push;
  p += v + carried;

  if (i32(i) == sim.drag) {
    // What it moved by, so what it holds is carried along, and it keeps going a little when let go.
    v = sim.dragPos - s.xy;
    let fast = length(v);
    if (fast > 40.0) { v *= 40.0 / fast; }
    p = sim.dragPos;
  }
  after[i] = vec4f(p, v);
}
`;

/**
 * Every node, one quad each, parents before children. A bubble is a filled
 * dot until it is big enough on screen to open, then a ring around what it
 * holds; what it holds fades in as it opens.
 */
export const NODES = /* wgsl */ `
${STRUCTS}
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
@group(0) @binding(2) var<storage, read> state: array<vec4f>;
${VIEW}

struct Out {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) radius: f32,
  /** How open, how visible, what kind (0 a page, 1 an empty page, 2 a block), how far lit up. */
  @location(2) @interpolate(flat) look: vec4f,
}

@vertex
fn vertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  let n = nodes[ii];
  var out: Out;
  var visible = 1.0;
  if (n.parent >= 0) {
    visible = smoothstep(${f(OPEN_LOW)}, ${f(OPEN_HIGH)}, rad(nodes[u32(n.parent)]) * view.zoom) * view.blocks;
  }
  if (visible <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    return out;
  }
  var open = 0.0;
  // Only what shows its blocks opens: a page that does not is a dot at any size.
  if (n.childCount > 0u) { open = smoothstep(${f(OPEN_LOW)}, ${f(OPEN_HIGH)}, rad(n) * view.zoom) * view.blocks; }
  let r = drawn(n);
  var corners = CORNERS;
  let corner = corners[vi] * (r + 2.0);
  out.position = clip((state[ii].xy - view.center) * view.zoom + corner);
  out.local = corner;
  out.radius = r;
  var kind = 2.0;
  if (n.parent < 0) { kind = select(0.0, 1.0, n.childCount == 0u); }
  out.look = vec4f(open, visible, kind, select(0.0, view.glow, i32(ii) == view.hover));
  return out;
}

@fragment
fn fragment(in: Out) -> @location(0) vec4f {
  let d = length(in.local);
  let r = in.radius;
  let disc = 1.0 - smoothstep(r - 0.75, r + 0.75, d);
  if (disc <= 0.0) { discard; }
  let open = in.look.x;
  var color = view.fg.rgb;
  var solid = 0.92;
  if (in.look.z > 1.5) { solid = 0.5; }
  if (in.look.z > 0.5 && in.look.z < 1.5) { color = view.muted.rgb; solid = 0.75; }
  let ring = smoothstep(r - 2.25, r - 1.0, d);
  var alpha = max(mix(solid, 0.045, open), ring * mix(0.0, 0.45, open));
  // Lit up by degrees, so a pointer crossing the map does not flash it.
  color = mix(color, view.accent.rgb, in.look.w);
  alpha = mix(alpha, max(mix(1.0, 0.1, open), ring), in.look.w);
  alpha *= disc * in.look.y;
  return vec4f(color * alpha, alpha);
}
`;

/**
 * Every arrow as it was written, one quad each. Each end is lifted to the
 * nearest bubble that shows at this zoom, here, so zooming never asks
 * anything of the CPU; arrows that land on the same two bubbles draw over
 * each other, and so many arrows between two pages read as a heavier line.
 */
export const EDGES = /* wgsl */ `
${STRUCTS}
struct Edge { tail: u32, tip: u32, kind: u32, spare: u32 }

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
@group(0) @binding(2) var<storage, read> state: array<vec4f>;
@group(0) @binding(3) var<storage, read> edges: array<Edge>;
${VIEW}

/** The nearest of a node's bubbles that shows: itself, if all above it are open. */
fn lift(i: u32) -> u32 {
  var n = i;
  var shown = i;
  for (var k = 0; k < 32; k++) {
    let above = nodes[n].parent;
    if (above < 0) { break; }
    n = u32(above);
    // With the blocks not showing, that is its page, whatever the zoom.
    if (view.blocks < 0.5 || rad(nodes[n]) * view.zoom < ${f(OPEN)}) { shown = n; }
  }
  return shown;
}

struct Out {
  @builtin(position) position: vec4f,
  /** Pixels back from the tip, and to the side of the line. */
  @location(0) at: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) head: f32,
}

@vertex
fn vertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  let e = edges[ii];
  let a = lift(e.tail);
  let b = lift(e.tip);
  var out: Out;
  out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
  if (a == b) { return out; }
  // The journal's line is for finding the days in a map of forces: the grid has its own order.
  if (e.kind == 3u && view.grid > 0.5) { return out; }
  let pa = (state[a].xy - view.center) * view.zoom;
  let pb = (state[b].xy - view.center) * view.zoom;
  let ra = drawn(nodes[a]);
  let rb = drawn(nodes[b]);
  let between = pb - pa;
  let apart = length(between);
  let span = apart - ra - rb - 1.0;
  if (span < 2.0) { return out; }
  let dir = between / apart;
  let side = vec2f(-dir.y, dir.x);
  // The line between two journal days points nowhere.
  let head = select(min(7.0, span * 0.45), 0.0, e.kind == 3u);
  let half = max(head * 0.5, 1.5) + 1.0;
  var corners = CORNERS;
  let corner = corners[vi];
  let along = (corner.x * 0.5 + 0.5) * span;
  out.position = clip(pa + dir * (ra + along) + side * corner.y * half);
  out.at = vec2f(span - along, corner.y * half);
  out.head = head;

  var color = view.fg;
  var alpha = 0.17;
  if (e.kind == 1u) { color = view.accent; alpha = 0.4; }
  if (e.kind == 2u) { color = view.tag; alpha = 0.5; }
  if (e.kind == 3u) { color = view.muted; alpha = 0.7; }
  if (view.hover >= 0) {
    // The lit bubble's arrows come forward and the rest fall back, by degrees.
    let lit = i32(a) == view.hover || i32(b) == view.hover;
    alpha = mix(alpha, select(alpha * 0.35, 0.95, lit), view.glow);
  }
  out.color = vec4f(color.rgb, alpha);
  return out;
}

@fragment
fn fragment(in: Out) -> @location(0) vec4f {
  let off = abs(in.at.y);
  let line = 1.0 - smoothstep(0.3, 1.0, off);
  let wide = in.at.x * 0.5;
  let arrow = (1.0 - smoothstep(wide - 0.6, wide + 0.6, off)) * (1.0 - step(in.head, in.at.x));
  let alpha = in.color.a * max(line, arrow);
  if (alpha <= 0.003) { discard; }
  return vec4f(in.color.rgb * alpha, alpha);
}
`;
