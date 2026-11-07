/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activated, activeOf, closed, each, next, opened, previous, single, updated } from './tabs.ts';
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
