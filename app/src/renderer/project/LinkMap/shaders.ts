/**
 * The graph view's WGSL: one compute step of the physics, and the two draws.
 * Every node is one particle in world space, whatever its depth; what makes
 * a bubble hold its blocks is forces, so a drag anywhere is felt elastically
 * by everything around it.
 */
import { MIN_BLOCK, MIN_PAGE, OPEN, OPEN_HIGH, OPEN_LOW } from './pick/pick';

/** A number as WGSL takes a float. */
const f = (value: number) => value.toFixed(3);

/** As `flat.ts` packs them (`gpu.ts`): 32 bytes a node, 16 a spring. */
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
}
`;

const VIEW = /* wgsl */ `
struct View {
  center: vec2f,
  size: vec2f,
  zoom: f32,
  hover: i32,
  fg: vec4f,
  muted: vec4f,
  accent: vec4f,
  tag: vec4f,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

/** A point in pixels from the view's middle, y down, as clip space has it. */
fn clip(px: vec2f) -> vec4f {
  return vec4f(px.x / (view.size.x * 0.5), -px.y / (view.size.y * 0.5), 0.0, 1.0);
}

/** A node's radius as drawn: never smaller than a dot. */
fn drawn(n: Node) -> f32 {
  return max(n.radius * view.zoom, select(${f(MIN_BLOCK)}, ${f(MIN_PAGE)}, n.parent < 0));
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
 */
export const SIM = /* wgsl */ `
${STRUCTS}
struct Spring { other: u32, kind: u32, strength: f32, rest: f32 }
struct Sim { count: u32, drag: i32, dragPos: vec2f, heat: f32 }

@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
@group(0) @binding(2) var<storage, read> springs: array<Spring>;
@group(0) @binding(3) var<storage, read> before: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> after: array<vec4f>;

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
  let m = n.radius * n.radius;
  let top = n.parent < 0;
  var a = vec2f(0.0);
  // Moved outright, not sped up: what keeps two bubbles from sitting in each other.
  var push = vec2f(0.0);
  var carried = vec2f(0.0);

  for (var k = 0u; k < n.sibCount; k++) {
    let j = n.sibStart + k;
    if (j == i) { continue; }
    let other = nodes[j].radius;
    var d = p - before[j].xy;
    var dist = length(d);
    if (dist < 0.001) {
      // On top of each other: apart, each its own way.
      let turn = f32((i * 7919u + j * 104729u) % 6283u) * 0.001;
      d = vec2f(cos(turn), sin(turn)) * 0.001;
      dist = 0.001;
    }
    let dir = d / dist;
    let reach = n.radius + other + GAP;
    if (dist < reach) {
      // The smaller of two gives way more.
      let share = other * other / (m + other * other);
      a += dir * (reach - dist) * COLLIDE * 2.0 * share;
      push += dir * (reach - dist) * APART * share;
      // And it stops closing in: many springs pulling one way add up, and a push alone loses to them.
      let closing = dot(v - before[j].zw, dir);
      if (closing < 0.0) { v -= dir * closing * share; }
    }
    if (top) {
      a += dir * sim.heat * CHARGE * (other + 1.0) / (max(dist - n.radius - other, 0.0) + 6.0);
    }
  }

  if (top) {
    a -= p * GRAVITY * sim.heat;
  } else {
    let above = nodes[u32(n.parent)];
    let its = before[u32(n.parent)];
    let d = p - its.xy;
    let dist = length(d);
    a -= d * CENTER / (above.radius * above.radius);
    let limit = max(above.radius - n.radius - RIM, 0.0);
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
  for (var k = 0u; k < n.childCount; k++) {
    let c = n.childStart + k;
    let cr = nodes[c].radius;
    let d = before[c].xy - p;
    let dist = length(d);
    let limit = max(n.radius - cr - RIM, 0.0);
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
      a += d / dist * clamp(dist - spring.rest, -20.0, 20.0) * spring.strength * LINK * sim.heat;
    } else {
      a += d / dist * PULL * spring.strength * sim.heat;
    }
  }

  v = (v + a) * DAMPING;
  let speed = length(v);
  if (speed > MAX_SPEED) { v *= MAX_SPEED / speed; }
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
  /** How open, how visible, what kind (0 a page, 1 an empty page, 2 a block), whether hovered. */
  @location(2) @interpolate(flat) look: vec4f,
}

@vertex
fn vertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  let n = nodes[ii];
  var out: Out;
  var visible = 1.0;
  if (n.parent >= 0) {
    visible = smoothstep(${f(OPEN_LOW)}, ${f(OPEN_HIGH)}, nodes[u32(n.parent)].radius * view.zoom);
  }
  if (visible <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    return out;
  }
  var open = 0.0;
  if (n.childCount > 0u) { open = smoothstep(${f(OPEN_LOW)}, ${f(OPEN_HIGH)}, n.radius * view.zoom); }
  let r = drawn(n);
  var corners = CORNERS;
  let corner = corners[vi] * (r + 2.0);
  out.position = clip((state[ii].xy - view.center) * view.zoom + corner);
  out.local = corner;
  out.radius = r;
  var kind = 2.0;
  if (n.parent < 0) { kind = select(0.0, 1.0, n.childCount == 0u); }
  out.look = vec4f(open, visible, kind, select(0.0, 1.0, i32(ii) == view.hover));
  return out;
}

@fragment
fn fragment(in: Out) -> @location(0) vec4f {
  let d = length(in.local);
  let r = in.radius;
  let disc = 1.0 - smoothstep(r - 0.75, r + 0.75, d);
  if (disc <= 0.0) { discard; }
  let open = in.look.x;
  let hovered = in.look.w > 0.5;
  var color = view.fg.rgb;
  var solid = 0.92;
  if (in.look.z > 1.5) { solid = 0.5; }
  if (in.look.z > 0.5 && in.look.z < 1.5) { color = view.muted.rgb; solid = 0.75; }
  let ring = smoothstep(r - 2.25, r - 1.0, d);
  var alpha = max(mix(solid, 0.045, open), ring * mix(0.0, 0.45, open));
  if (hovered) {
    color = view.accent.rgb;
    alpha = max(mix(1.0, 0.1, open), ring);
  }
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
    if (nodes[n].radius * view.zoom < ${f(OPEN)}) { shown = n; }
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
  let head = min(7.0, span * 0.45);
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
  if (view.hover >= 0) {
    if (i32(a) == view.hover || i32(b) == view.hover) { alpha = 0.95; } else { alpha *= 0.35; }
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
