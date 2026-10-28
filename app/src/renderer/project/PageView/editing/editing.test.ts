/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate } from '@pbnotes/pages';
import type { Block } from '@pbnotes/pages';
import { afterCancel, afterDelete, movable, newBlock } from './editing.ts';

const block = (id: string, children: Block[] = []): Block => ({
  id,
  text: `text of ${id}`,
  children,
});

/**
 * a
 *   a1
 *   a2
 *     a2x
 * b
 */
const page = [
  block('a', [block('a1'), block('a2', [block('a2x')])]),
  block('b'),
];
const at = (id: string): Block => {
  const found = locate(page, id);
  if (!found) throw new Error(`no ${id}`);
  return found.siblings[found.at];
};
const end = (id: string) => ({ editing: id, at: `text of ${id}`.length });

// Backspace in the empty box of a block that exists.

test('a block with children is not deleted by Backspace', () => {
  assert.equal(afterDelete(page, at('a2'), { reference: false }), null);
});

test('the caret goes to the end of the block above in reading order', () => {
  // The sibling above, descended to its deepest last child.
  assert.deepEqual(afterDelete(page, at('b'), { reference: false })?.caret, end('a2x'));
  // A first child: the block it is filed under.
  assert.deepEqual(afterDelete(page, at('a1'), { reference: false })?.caret, end('a'));
});

test("above the page's first block, the caret goes to the start of the block below", () => {
  const flat = [block('x'), block('y')];
  assert.deepEqual(afterDelete(flat, flat[0], { reference: false }), {
    caret: { editing: 'y', at: 0 },
    openTail: false,
    unzoom: undefined,
  });
});

test('the only block: the box at the end of the page opens, except in a cut', () => {
  const only = [block('x')];
  assert.deepEqual(afterDelete(only, only[0], { reference: false }), {
    caret: null,
    openTail: true,
    unzoom: undefined,
  });
  assert.equal(afterDelete(only, only[0], { reference: true })?.openTail, false);
});

test('deleting the zoomed root moves the zoom out to its parent, or to the page', () => {
  assert.deepEqual(
    afterDelete(page, at('a1'), { root: at('a1'), reference: false })?.unzoom,
    { to: 'a' },
  );
  assert.deepEqual(
    afterDelete(page, at('b'), { root: at('b'), reference: false })?.unzoom,
    { to: undefined },
  );
  assert.equal(
    afterDelete(page, at('a1'), { root: at('a'), reference: false })?.unzoom,
    undefined,
  );
});

// Backspace in the empty box for a block that does not exist yet.

test('backing out of a new box lands at the end of the block directly above it', () => {
  // A box beneath `a` renders below its whole subtree.
  assert.deepEqual(afterCancel(page, 'a'), end('a2x'));
  // The box at the end of the page, and the one at the end of a zoom.
  assert.deepEqual(afterCancel(page, undefined), end('b'));
  assert.deepEqual(afterCancel(page, undefined, at('a')), end('a2x'));
});

test('with nothing above it, a new box stays open', () => {
  assert.equal(afterCancel([], undefined), null);
  assert.equal(afterCancel(page, 'gone'), null);
});

// A key in the box for a new block.

test('leaving an empty box writes nothing; leaving one with text writes it', () => {
  assert.deepEqual(newBlock(page, { after: 'b', text: '', then: 'stop' }), {
    kind: 'nothing',
  });
  assert.deepEqual(newBlock(page, { after: 'b', text: 'hi', then: 'stop' }), {
    kind: 'write',
    after: 'b',
    indent: false,
    move: undefined,
  });
});

test('Enter on an empty box among children pops it out a level, then makes a gap at the top', () => {
  // Beneath `a1`, a child of `a`: the box moves beside `a`.
  assert.deepEqual(newBlock(page, { after: 'a1', text: '', then: 'again' }), {
    kind: 'pop',
    after: 'a',
  });
  // Beside `a`, at the top level, Enter writes an empty block: a gap.
  assert.equal(newBlock(page, { after: 'a', text: '', then: 'again' }).kind, 'write');
  // Shift+Tab on an empty child box pops it the same way.
  assert.equal(newBlock(page, { after: 'a1', text: '', then: 'outdent' }).kind, 'pop');
});

test('zoomed, Enter does not pop past the root, and Shift+Tab does not leave the view', () => {
  const root = at('a');
  // Beneath `a1`, one of the root's children: the top level of the view.
  assert.deepEqual(
    newBlock(page, { root, after: 'a1', text: '', then: 'again' }),
    { kind: 'write', after: 'a1', indent: false, move: undefined },
  );
  assert.deepEqual(newBlock(page, { root, after: 'a1', text: 'hi', then: 'outdent' }), {
    kind: 'write',
    after: 'a1',
    indent: false,
    move: undefined,
  });
  // Deeper in, beneath `a2x`, Shift+Tab moves the block out a level.
  assert.deepEqual(newBlock(page, { root, after: 'a2x', text: 'hi', then: 'outdent' }), {
    kind: 'write',
    after: 'a2x',
    indent: false,
    move: -1,
  });
});

test('the box at the end of a zoom writes under the root, and a bare root takes a second step', () => {
  assert.deepEqual(newBlock(page, { root: at('a'), text: 'hi', then: 'again' }), {
    kind: 'write',
    after: 'a2',
    indent: false,
    move: undefined,
  });
  assert.deepEqual(newBlock(page, { root: at('b'), text: 'hi', then: 'stop' }), {
    kind: 'write',
    after: 'b',
    indent: true,
    move: undefined,
  });
  // Shift+Tab as that bare root's first child is out of the view: no move.
  assert.equal(
    (newBlock(page, { root: at('b'), text: 'hi', then: 'outdent' }) as { move?: number })
      .move,
    undefined,
  );
});

test('Tab in a new box writes the block and then files it under the one above', () => {
  assert.deepEqual(newBlock(page, { after: 'b', text: 'hi', then: 'indent' }), {
    kind: 'write',
    after: 'b',
    indent: false,
    move: 1,
  });
});

// Tab and Shift+Tab on a block that exists.

test('a block may move, except out of the view a zoom shows', () => {
  assert.equal(movable(page, 'gone', 1), false);
  assert.equal(movable(page, 'b', 1), true);
  const root = at('a');
  assert.equal(movable(page, 'a', 1, root), false);
  assert.equal(movable(page, 'a2', -1, root), false);
  assert.equal(movable(page, 'a2', 1, root), true);
  assert.equal(movable(page, 'a2x', -1, root), true);
});
