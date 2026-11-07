/**
 * The tabs of a window (#298, #303): each tab's id and what it keeps while
 * it is not drawn (`TabState`), in the order the strip shows them, and
 * which one is active. Pure, so it runs under `node --test`; `ProjectView`
 * holds it and draws the active tab.
 *
 * Every step hands back what it was given when it changes nothing, so a
 * step that misses changes nothing on screen either. Ids are handed in:
 * whoever opens a tab names it.
 */
import { NEW_TAB } from '../Tab/state/state.ts';
import type { TabState } from '../Tab/state/state.ts';

export type Entry = { readonly id: string; readonly tab: TabState };

export type Tabs = {
  /** In the order they show, never empty. */
  readonly list: readonly Entry[];
  /** The id of the tab drawn. Always one in `list`. */
  readonly active: string;
  /**
   * The last tab opened behind the active one (#309), while it stays the
   * active one: the next opened behind it goes after this one, so a run of
   * them keeps the order they were opened in, as a browser's do.
   */
  readonly behind?: string;
};

/** A window as it opens: one tab, on the journal. */
export function single(id: string): Tabs {
  return { list: [{ id, tab: NEW_TAB }], active: id };
}

/** The tab drawn. */
export function activeOf(tabs: Tabs): Entry {
  return tabs.list.find((it) => it.id === tabs.active) ?? tabs.list[0];
}

/**
 * A new tab named `id`, right after the active one, and active: on the
 * journal, or wherever `tab` says, as a link opened in a new tab is (#309).
 */
export function opened(tabs: Tabs, id: string, tab: TabState = NEW_TAB): Tabs {
  const at = tabs.list.findIndex((it) => it.id === tabs.active);
  const list = [...tabs.list];
  list.splice(at + 1, 0, { id, tab });
  return { list, active: id };
}

/**
 * A new tab named `id`, where `tab` says, left behind the active one, which
 * stays active (#309): right after it, or after the last one opened behind
 * it, so a run of them is in the order they were opened.
 */
export function openedBehind(tabs: Tabs, id: string, tab: TabState): Tabs {
  const after = tabs.list.some((it) => it.id === tabs.behind) ? tabs.behind : tabs.active;
  const at = tabs.list.findIndex((it) => it.id === after);
  const list = [...tabs.list];
  list.splice(at + 1, 0, { id, tab });
  return { list, active: tabs.active, behind: id };
}

/**
 * The tab `id` closed. Closing the active one makes the tab to its right
 * active, or to its left when it was the last. Undefined when it was the
 * only tab: there is no window of none, so the window is what closes.
 */
export function closed(tabs: Tabs, id: string): Tabs | undefined {
  const at = tabs.list.findIndex((it) => it.id === id);
  if (at === -1) return tabs;
  if (tabs.list.length === 1) return undefined;
  const list = tabs.list.filter((it) => it.id !== id);
  if (tabs.active !== id) return { ...tabs, list };
  return { list, active: (list[at] ?? list[at - 1]).id };
}

/** The tab `id` active. */
export function activated(tabs: Tabs, id: string): Tabs {
  if (tabs.active === id || !tabs.list.some((it) => it.id === id)) return tabs;
  return { list: tabs.list, active: id };
}

/** The tab `by` places along from the active one, wrapping round either end. */
function along(tabs: Tabs, by: 1 | -1): Tabs {
  const at = tabs.list.findIndex((it) => it.id === tabs.active);
  const n = tabs.list.length;
  return activated(tabs, tabs.list[(at + by + n) % n].id);
}

/** The tab to the right of the active one, or the first after the last. */
export function next(tabs: Tabs): Tabs {
  return along(tabs, 1);
}

/** The tab to the left of the active one, or the last before the first. */
export function previous(tabs: Tabs): Tabs {
  return along(tabs, -1);
}

/** The tab `id` stepped by `step`. A tab closed since is left closed. */
export function updated(tabs: Tabs, id: string, step: (tab: TabState) => TabState): Tabs {
  let changed = false;
  const list = tabs.list.map((it) => {
    if (it.id !== id) return it;
    const tab = step(it.tab);
    if (tab === it.tab) return it;
    changed = true;
    return { id, tab };
  });
  return changed ? { ...tabs, list } : tabs;
}

/** Every tab stepped by `step`: a rename or a delete, which reaches them all. */
export function each(tabs: Tabs, step: (tab: TabState) => TabState): Tabs {
  return tabs.list.reduce((all, it) => updated(all, it.id, step), tabs);
}
