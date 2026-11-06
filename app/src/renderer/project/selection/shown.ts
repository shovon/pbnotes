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
import type { Empty as DropEmpty, Row as DropRow } from '../drag/drop/drop';

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

/**
 * The scope of `title` kept open in the right sidebar (#287): never the
 * scope the same page has on the left, or a cut of it.
 */
export function beside(title: string): string {
  return JSON.stringify({ beside: title });
}

/**
 * The attributes a view puts on a block it draws. `parent` is the block it
 * shows under, if any; `whole` says the view shows the whole page, so its
 * top blocks are the page's top level, which a drop above them can name
 * (#251).
 */
export function slot(
  scope: string,
  page: string,
  id: string,
  { parent, whole = false }: { parent?: string; whole?: boolean } = {},
) {
  return {
    'data-slot': slotKey(scope, id),
    'data-slot-scope': scope,
    'data-slot-page': page,
    'data-slot-block': id,
    ...(parent === undefined ? {} : { 'data-slot-parent': slotKey(scope, parent) }),
    ...(whole ? { 'data-slot-whole': '' } : {}),
  };
}

/** What a view puts on the room a page with no blocks yet shows, for a drop to land in (#251). */
export function emptyPage(page: string) {
  return { 'data-empty-page': page };
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

/**
 * Every block's own row under `root`, in the order it shows, in page
 * coordinates: where a drag touches it (#262). A slot holds its row and dot,
 * and never its children, which a view draws beside it.
 */
export function rows(root: ParentNode | null | undefined): { key: string; top: number; bottom: number }[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('[data-slot]')].flatMap((element) => {
    const key = element.dataset.slot;
    if (key === undefined) return [];
    const { top, bottom } = element.getBoundingClientRect();
    return [{ key, top: top + window.scrollY, bottom: bottom + window.scrollY }];
  });
}

/**
 * Every block's own row under `root`, as a drop reads it (#251): the slot
 * and what it shows, and its box, in page coordinates.
 */
export function dropRows(root: ParentNode | null | undefined): DropRow[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('[data-slot]')].flatMap((element) => {
    const { slot: key, slotScope: scope, slotPage: page, slotBlock: id, slotParent: parent } =
      element.dataset;
    if (key === undefined || scope === undefined || page === undefined || id === undefined) {
      return [];
    }
    return [
      {
        key,
        scope,
        page,
        id,
        ...(parent === undefined ? {} : { parent }),
        ...box(element),
        whole: element.dataset.slotWhole !== undefined,
      },
    ];
  });
}

/** Every page with no blocks yet under `root`, with the room it shows, in page coordinates. */
export function emptyPages(root: ParentNode | null | undefined): DropEmpty[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('[data-empty-page]')].flatMap((element) => {
    const page = element.dataset.emptyPage;
    return page === undefined ? [] : [{ page, ...box(element) }];
  });
}

/** Where `element` is, in page coordinates. */
function box(element: Element) {
  const { top, bottom, left, right } = element.getBoundingClientRect();
  return {
    top: top + window.scrollY,
    bottom: bottom + window.scrollY,
    left: left + window.scrollX,
    right: right + window.scrollX,
  };
}
