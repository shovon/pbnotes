/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activated, activeOf, closed, each, moved, next, opened, openedBehind, previous, single, updated } from './tabs.ts';
import type { Tabs } from './tabs.ts';
import { NEW_TAB, left, renamedIn } from '../Tab/state/state.ts';

/** Tabs `a`, `b`, `c`, with `active` drawn. */
const three = (active: string): Tabs => ({ ...opened(opened(single('a'), 'b'), 'c'), active });
const ids = (tabs: Tabs) => tabs.list.map((it) => it.id);
const on = (page: string) => (tab: typeof NEW_TAB) => ({ ...tab, trail: [{ page }] });

test('a window opens with one tab, on the journal, active', () => {
  const tabs = single('a');
  assert.deepEqual(ids(tabs), ['a']);
  assert.equal(activeOf(tabs).tab, NEW_TAB);
});

test('a new tab opens right after the active one, on the journal, and is active', () => {
  const tabs = opened(three('a'), 'd');
  assert.deepEqual(ids(tabs), ['a', 'd', 'b', 'c']);
  assert.equal(tabs.active, 'd');
  assert.equal(activeOf(tabs).tab, NEW_TAB);
});

test('closing the active tab makes the one to its right active', () => {
  const tabs = closed(three('b'), 'b');
  assert.deepEqual(tabs && ids(tabs), ['a', 'c']);
  assert.equal(tabs?.active, 'c');
});

test('closing the last tab, active, makes the one to its left active', () => {
  assert.equal(closed(three('c'), 'c')?.active, 'b');
});

test('closing a tab that is not active leaves the active one', () => {
  const tabs = closed(three('a'), 'c');
  assert.deepEqual(tabs && ids(tabs), ['a', 'b']);
  assert.equal(tabs?.active, 'a');
});

test('closing the only tab leaves no tabs: the window closes', () => {
  assert.equal(closed(single('a'), 'a'), undefined);
});

test('closing a tab that is not there changes nothing', () => {
  const tabs = three('a');
  assert.equal(closed(tabs, 'x'), tabs);
});

test('activating a tab draws it; one already active, or not there, changes nothing', () => {
  const tabs = three('a');
  assert.equal(activated(tabs, 'c').active, 'c');
  assert.equal(activated(tabs, 'a'), tabs);
  assert.equal(activated(tabs, 'x'), tabs);
});

test('next and previous move one tab along, wrapping round both ends', () => {
  assert.equal(next(three('a')).active, 'b');
  assert.equal(next(three('c')).active, 'a');
  assert.equal(previous(three('b')).active, 'a');
  assert.equal(previous(three('a')).active, 'c');
});

test('with one tab, next and previous change nothing', () => {
  const tabs = single('a');
  assert.equal(next(tabs), tabs);
  assert.equal(previous(tabs), tabs);
});

test('a step reaches the tab it names, and only that one', () => {
  const tabs = updated(three('a'), 'b', on('Mira'));
  assert.deepEqual(tabs.list[1].tab.trail, [{ page: 'Mira' }]);
  assert.equal(tabs.list[0].tab, NEW_TAB);
  assert.equal(tabs.list[2].tab, NEW_TAB);
});

test('a step that changes nothing, or names a tab closed since, leaves the very same tabs', () => {
  const tabs = three('a');
  assert.equal(updated(tabs, 'b', (tab) => tab), tabs);
  assert.equal(updated(tabs, 'x', on('Mira')), tabs);
});

test('a rename and a delete reach every tab', () => {
  const start = updated(updated(three('a'), 'a', on('Mira')), 'c', on('Mira'));
  const renamed = each(start, (tab) => renamedIn(tab, 'Mira', 'Vera'));
  assert.deepEqual(renamed.list.map((it) => it.tab.trail), [[{ page: 'Vera' }], [], [{ page: 'Vera' }]]);
  const gone = each(start, (tab) => left(tab, 'mira'));
  assert.deepEqual(gone.list.map((it) => it.tab.trail), [[], [], []]);
});

test('a rename no tab holds leaves the very same tabs', () => {
  const tabs = three('a');
  assert.equal(each(tabs, (tab) => renamedIn(tab, 'Mira', 'Vera')), tabs);
});

test('a new tab can open somewhere already, after the active one, and active (#309)', () => {
  const start = { ...NEW_TAB, trail: [{ page: 'Mira' }] };
  const tabs = opened(three('b'), 'd', start);
  assert.deepEqual(ids(tabs), ['a', 'b', 'd', 'c']);
  assert.equal(tabs.active, 'd');
  assert.equal(activeOf(tabs).tab, start);
});

test('a tab opened behind goes right after the active one, which stays active (#309)', () => {
  const start = { ...NEW_TAB, trail: [{ page: 'Mira' }] };
  const tabs = openedBehind(three('a'), 'd', start);
  assert.deepEqual(ids(tabs), ['a', 'd', 'b', 'c']);
  assert.equal(tabs.active, 'a');
  assert.equal(tabs.list[1].tab, start);
});

test('a run of tabs opened behind keeps the order they were opened in (#309)', () => {
  const tabs = openedBehind(openedBehind(openedBehind(three('a'), 'd', NEW_TAB), 'e', NEW_TAB), 'f', NEW_TAB);
  assert.deepEqual(ids(tabs), ['a', 'd', 'e', 'f', 'b', 'c']);
  assert.equal(tabs.active, 'a');
});

test('showing another tab starts a new run, after that one (#309)', () => {
  const run = openedBehind(three('a'), 'd', NEW_TAB);
  const tabs = openedBehind(activated(run, 'c'), 'e', NEW_TAB);
  assert.deepEqual(ids(tabs), ['a', 'd', 'b', 'c', 'e']);
});

test('the last tab of a run closed, the next goes after the active one again (#309)', () => {
  const run = openedBehind(three('a'), 'd', NEW_TAB);
  const tabs = openedBehind(closed(run, 'd') as Tabs, 'e', NEW_TAB);
  assert.deepEqual(ids(tabs), ['a', 'e', 'b', 'c']);
});

test('a tab moved goes to that place, and the rest keep their order (#338)', () => {
  assert.deepEqual(ids(moved(three('a'), 'a', 2)), ['b', 'c', 'a']);
  assert.deepEqual(ids(moved(three('a'), 'c', 0)), ['c', 'a', 'b']);
  assert.deepEqual(ids(moved(three('a'), 'a', 1)), ['b', 'a', 'c']);
});

test('moving a tab never changes which is active (#338)', () => {
  assert.equal(moved(three('b'), 'a', 2).active, 'b');
  assert.equal(moved(three('b'), 'b', 0).active, 'b');
});

test('a move past either end stops there (#338)', () => {
  assert.deepEqual(ids(moved(three('a'), 'b', 99)), ['a', 'c', 'b']);
  assert.deepEqual(ids(moved(three('a'), 'b', -5)), ['b', 'a', 'c']);
});

test('a move to where it is, or of a tab not there, leaves the very same tabs (#338)', () => {
  const tabs = three('a');
  assert.equal(moved(tabs, 'b', 1), tabs);
  assert.equal(moved(tabs, 'x', 0), tabs);
});

test('a move ends a run of tabs opened behind (#338)', () => {
  const run = openedBehind(three('a'), 'd', NEW_TAB);
  const tabs = openedBehind(moved(run, 'c', 0), 'e', NEW_TAB);
  assert.deepEqual(ids(tabs), ['c', 'a', 'e', 'd', 'b']);
});
