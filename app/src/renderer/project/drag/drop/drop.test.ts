/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropAt } from './drop.ts';
import type { Empty, Row } from './drop.ts';

const INDENT = 24;
const LEFT = 100;
const HEIGHT = 20;
const GAP = 4;

/**
 * Rows for one view, from lines like `"a"`, `"  a1"`: two spaces a level.
 * Each row is `HEIGHT` tall with `GAP` between, starting at `from`.
 */
function view(scope: string, lines: string[], { from = 0, whole = true, page = scope } = {}): Row[] {
  const stack: Row[] = [];
  return lines.map((line, index) => {
    const level = (line.length - line.trimStart().length) / 2;
    const id = line.trim();
    stack.length = level;
    const parent = stack[level - 1];
    const top = from + index * (HEIGHT + GAP);
    const row: Row = {
      key: `${scope}/${id}`,
      scope,
      page,
      id,
      ...(parent ? { parent: parent.key } : {}),
      top,
      bottom: top + HEIGHT,
      left: LEFT + level * INDENT,
      right: 600,
      whole,
    };
    stack[level] = row;
    return row;
  });
}

/** The pointer's x over the dot of a block at `level`. */
const at = (level: number) => LEFT + level * INDENT + INDENT / 2;
/** A height in the lower half of row `index`, starting at `from`. */
const below = (index: number, from = 0) => from + index * (HEIGHT + GAP) + HEIGHT - 2;
/** A height in the upper half of row `index`. */
const above = (index: number, from = 0) => from + index * (HEIGHT + GAP) + 2;

const place = (rows: Row[], moving: string | string[], x: number, y: number, empties: Empty[] = []) => {
  const drop = dropAt(rows, empties, new Set([moving].flat()), x, y, INDENT);
  return drop && { page: drop.page, ...drop.place };
};

const PAGE = view('Foo', ['a', '  a1', '  a2', 'b', 'c']);

test('below a block, at its depth, goes after it', () => {
  assert.deepEqual(place(PAGE, 'c', at(0), below(3)), { page: 'Foo', after: 'b' });
  assert.deepEqual(place(PAGE, 'b', at(1), below(1)), { page: 'Foo', after: 'a1', parent: 'a' });
});

test('below a block and one level right goes first under it', () => {
  assert.deepEqual(place(PAGE, 'c', at(1), below(3)), { page: 'Foo', parent: 'b' });
  // Far right is as deep as the gap allows, and no deeper.
  assert.deepEqual(place(PAGE, 'c', at(6), below(3)), { page: 'Foo', parent: 'b' });
});

test('below the last child, further left climbs out to its parent', () => {
  assert.deepEqual(place(PAGE, 'c', at(0), below(2)), { page: 'Foo', after: 'a' });
  assert.deepEqual(place(PAGE, 'c', at(1), below(2)), { page: 'Foo', after: 'a2', parent: 'a' });
});

test('a gap above a child cannot climb out: the row below holds the depth', () => {
  // Between a1 and a2, far left: still a sibling of a1, not after a.
  assert.deepEqual(place(PAGE, 'c', at(0), below(1)), { page: 'Foo', after: 'a1', parent: 'a' });
  // Between a and a1: first under a, whatever the x.
  assert.deepEqual(place(PAGE, 'c', at(0), below(0)), { page: 'Foo', parent: 'a' });
});

test('the upper half of a row is the gap above it', () => {
  assert.deepEqual(place(PAGE, 'c', at(0), above(3)), place(PAGE, 'c', at(0), below(2)));
});

test('above the first row of a page goes first on the page', () => {
  assert.deepEqual(place(PAGE, 'c', at(0), above(0)), { page: 'Foo', first: true });
});

test('above the first row of a zoom or a linked reference lands nowhere', () => {
  const cut = view('Bar-cut', ['x', '  x1'], { whole: false, page: 'Bar' });
  assert.equal(place(cut, 'c', at(0), above(0)), undefined);
});

test('in a zoom, the root\'s children are one level in, and a drop lands at the depth it shows', () => {
  // The root at the left edge, its children one indent in under it (#340).
  const zoom = view('zoom', ['r', '  r1', '  r2', '    r2a'], { whole: false, page: 'Bar' });
  assert.deepEqual(place(zoom, 'r1', at(1), below(3)), { page: 'Bar', after: 'r2', parent: 'r' });
  assert.deepEqual(place(zoom, 'r1', at(2), below(3)), { page: 'Bar', after: 'r2a', parent: 'r2' });
  // Under the root itself, first among its children whatever the x.
  assert.deepEqual(place(zoom, 'r2', at(0), below(0)), { page: 'Bar', parent: 'r' });
});

test('a drop in a linked reference lands on that page, beside or under the block', () => {
  const cut = view('cut', ['x', '  x1'], { whole: false, page: 'Bar', from: 200 });
  const rows = [...PAGE, ...cut];
  assert.deepEqual(place(rows, 'a', at(0), below(1, 200)), { page: 'Bar', after: 'x' });
  assert.deepEqual(place(rows, 'a', at(2), below(1, 200)), { page: 'Bar', parent: 'x1' });
});

test("the block's own rows and its subtree are no place to drop", () => {
  assert.equal(place(PAGE, 'a', at(1), below(0)), undefined);
  assert.equal(place(PAGE, 'a', at(1), below(1)), undefined);
  // Next to them is: the gap closes over them, so after b is after b.
  assert.deepEqual(place(PAGE, 'a', at(0), above(3)), { page: 'Foo', first: true });
});

test("a gap at the end of one view does not run into the next view's rows", () => {
  const day = view('Day', ['d'], { from: 200, page: 'Day' });
  const rows = [...PAGE, ...day];
  // Below c, the last row of Foo: anything to the left is the top level of Foo.
  assert.deepEqual(place(rows, 'a', at(0), below(4)), { page: 'Foo', after: 'c' });
  // Above d, the first row of Day.
  assert.deepEqual(place(rows, 'a', at(0), above(0, 200)), { page: 'Day', first: true });
});

test('far from every row is nowhere', () => {
  assert.equal(place(PAGE, 'c', at(0), 1000), undefined);
  assert.equal(place(PAGE, 'c', at(0), -50), undefined);
});

test('in the gap between two rows counts as the nearer one', () => {
  const between = HEIGHT + GAP / 2 - 1;
  assert.deepEqual(place(PAGE, 'c', at(0), between), place(PAGE, 'c', at(0), below(0)));
});

test('a page with no blocks takes the drop as its first block', () => {
  const empty: Empty = { page: '2026-11-04', top: 300, bottom: 330, left: LEFT, right: 600 };
  assert.deepEqual(place(PAGE, 'c', at(0), 310, [empty]), { page: '2026-11-04' });
});

test('the line is drawn between the rows, at the depth chosen', () => {
  const drop = dropAt(PAGE, [], new Set(['elsewhere']), at(1), below(3), INDENT);
  assert.deepEqual(drop?.line, {
    top: 3 * (HEIGHT + GAP) + HEIGHT + GAP / 2,
    left: LEFT + INDENT,
    right: 600,
  });
});

test('several blocks: every one of their rows is left out, so a gap closes over them (#269)', () => {
  // Dragging a and c: no line beside either, and a drop between b and c is after b.
  assert.equal(place(PAGE, ['a', 'c'], at(1), below(1)), undefined);
  assert.deepEqual(place(PAGE, ['a', 'c'], at(0), above(4)), { page: 'Foo', after: 'b' });
  assert.deepEqual(place(PAGE, ['a', 'c'], at(0), above(3)), { page: 'Foo', first: true });
});

test('a drop says which view it is in, and none for a page with no blocks', () => {
  const day = view('Day', ['d'], { from: 200, page: 'Day' });
  assert.equal(dropAt([...PAGE, ...day], [], new Set(['a']), at(0), below(0, 200), INDENT)?.scope, 'Day');
  const empty: Empty = { page: 'Bare', top: 300, bottom: 330, left: LEFT, right: 600 };
  assert.equal(dropAt(PAGE, [empty], new Set(['a']), at(0), 310, INDENT)?.scope, undefined);
});
