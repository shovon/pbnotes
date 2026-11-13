/**
 * What a tab keeps while it is not drawn: where it is, how it got there,
 * and what it has open beside it. Pure, so it runs under `node --test`;
 * `ProjectView` holds it, and `Tab` draws it and steps it.
 *
 * Only what has to outlive the tab being drawn is here. What a tab draws
 * (main's answer, a selection, a drag) is the drawn tab's own.
 */
import { renamed, leave, placeOf } from '../../trail/trail.ts';
import type { Stop } from '../../trail/trail.ts';
import { renamedIn as renamedInStack } from '../../Aside/stack/stack.ts';
import { INITIAL_WIDTH } from '../../Aside/width/width.ts';
import { INITIAL } from '../../AllPages/sort/sort.ts';
import type { Sort } from '../../AllPages/sort/sort.ts';
import { OPEN_TASKS } from '../../../../shared/graph.ts';
import type { Filter } from '../../../../shared/graph.ts';

/**
 * A block to scroll to and flash once its page has drawn, and the version
 * the view has to hold first: an undo's (#248), so a block it brought back
 * is drawn before it is looked for. 0 for a block already there.
 */
export type Target = { id: string; version: number };

export type TabState = {
  /** Where the tab is, as how it got there (`trail/`). Empty is the journal. */
  trail: Stop[];
  /** How the list of every page is sorted, so back to it finds it as it was. */
  sort: Sort;
  /**
   * Which tasks the Tasks view shows (#387), so back to it finds it as it
   * was. This machine's and this tab's: never an event.
   */
  filter: Filter;
  /** The pages kept open beside it (#287), most recently opened first. */
  aside: string[];
  /** How wide the aside is. */
  asideWidth: number;
  /** A block to bring into view once it is drawn. */
  target: Target | null;
};

/** A tab as it opens: on the journal, with nothing beside it. */
export const NEW_TAB: TabState = {
  trail: [],
  sort: INITIAL,
  filter: OPEN_TASKS,
  aside: [],
  asideWidth: INITIAL_WIDTH,
  target: null,
};

/**
 * `tab` with `key` set to `value`, or `tab` itself when it already holds
 * that very value, so a step that changes nothing changes nothing.
 */
export function withField<K extends keyof TabState>(
  tab: TabState,
  key: K,
  value: TabState[K],
): TabState {
  return tab[key] === value ? tab : { ...tab, [key]: value };
}

/**
 * The page `from` is now called `to` (#109): the trail and the aside read
 * `to` wherever they held `from`. The same tab when neither held it.
 */
export function renamedIn(tab: TabState, from: string, to: string): TabState {
  return withField(
    withField(tab, 'trail', renamed(tab.trail, from, to)),
    'aside',
    renamedInStack(tab.aside, from, to),
  );
}

/**
 * The page `gone` was deleted: the tab steps back off it (`leave`). The
 * same tab when it was not on it.
 */
export function left(tab: TabState, gone: string): TabState {
  return withField(tab, 'trail', leave(tab.trail, gone));
}

/**
 * Every page name the tab holds, as it holds it: each stop on the trail
 * that is on a page, and each card beside it. What to ask main about when
 * a page may have been renamed while the tab was not looking (#301).
 */
export function held(tab: TabState): string[] {
  const pages = tab.trail.flatMap((stop) => {
    const at = placeOf(stop);
    return at === undefined ? [] : [at.page];
  });
  return [...pages, ...tab.aside];
}
