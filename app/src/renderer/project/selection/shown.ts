/**
 * Where each block shows, written on the screen and read back off it (#253).
 * A page view marks every block it draws with `slot`; `ProjectView` reads
 * them in document order with `shown`, which is the order a selection runs
 * in, across every day and every linked reference on screen.
 *
 * A block can show more than once, so a slot is the block in one view: the
 * view's `scope` and the block's id. A page's scope is its title, and a cut
 * under it is `under(scope, title)`.
 */
import type { Shown } from './roots/roots';

/** One place a block shows. */
export type Entry = Shown & {
  /** The view it shows in: everything Cmd+A selects shares it. */
  scope: string;
  /** The page it is on, for whatever acts on it. */
  page: string;
};

/** The key for `id` shown in `scope`. */
export function slotKey(scope: string, id: string): string {
  return JSON.stringify([scope, id]);
}

/** The scope of a cut of `title` shown under the view `scope`. */
export function under(scope: string, title: string): string {
  return JSON.stringify([scope, title]);
}

/** The attributes a view puts on a block it draws. */
export function slot(scope: string, page: string, id: string, parent?: string) {
  return {
    'data-slot': slotKey(scope, id),
    'data-slot-scope': scope,
    'data-slot-page': page,
    'data-slot-block': id,
    ...(parent === undefined ? {} : { 'data-slot-parent': slotKey(scope, parent) }),
  };
}

/** Every block showing under `root`, in the order it shows. */
export function shown(root: ParentNode | null | undefined): Entry[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('[data-slot]')].flatMap((element) => {
    const { slot: key, slotScope: scope, slotPage: page, slotBlock: id, slotParent: parent } =
      element.dataset;
    if (key === undefined || scope === undefined || page === undefined || id === undefined) {
      return [];
    }
    return [{ key, scope, page, id, ...(parent === undefined ? {} : { parent }) }];
  });
}
