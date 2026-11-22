/**
 * The Tasks contract (#387): the types and channel names that main, preload
 * and the renderer share for the Tasks view, and nothing else of theirs.
 * It is the one file in this slice every process imports, so it is bundled
 * into the renderer too: types and constants only, no `node:` imports, and
 * nothing imported from `main/` or `renderer/`.
 *
 * What a task is, and reading one from a block, are `@pbnotes/graph`
 * (`src/tasks/`), which other programs read a folder with.
 */
import type { Marker, Page } from '@pbnotes/graph';

/**
 * One condition a block has to meet to show in a filtered view: the first
 * sketch of block filters (#387). A tagged union, so the next kinds of
 * condition (a page, a tag, a link, a range of dates) slot in beside it.
 *
 * - `marker`: the block is a task under any of `markers` (#376).
 */
export type Condition = { kind: 'marker'; markers: Marker[] };

/**
 * What a block has to meet to show: every condition in it. None is no
 * filter at all, so every task shows. At most one of each kind: a second of
 * a kind is the first one with more in it.
 */
export type Filter = Condition[];

/** What was picked in the filter menu: a value of a kind of condition, to turn on or off. */
export type FilterPick = { kind: 'marker'; marker: Marker };

/** The Tasks view as it opens: what is still to do, done tasks out of the way. */
export const OPEN_TASKS: Filter = [{ kind: 'marker', markers: ['TODO', 'DOING'] }];

/**
 * Every task in the project that meets a filter (#387), as main read it:
 * the answer to `tasks`. Each page is cut down to its tasks, as a linked
 * reference is cut down to the blocks that link, and drawn the same way.
 */
export type TaskView = {
  /** The fold version this was read at, as `PlaceView.version` is. */
  version: number;
  /**
   * The pages with a task that meets the filter, in the order pages are
   * listed, loaded so far: up to and including the one titled
   * `list.through`.
   */
  pages: Page[];
  /** How many tasks meet the filter, on every page, loaded or not. */
  shown: number;
  /** How many tasks there are at all, filter or none. */
  total: number;
  /** What each `((id))` on the pages showing shows, as `PlaceView.previews`. */
  previews: [string, string | null][];
  /**
   * How far the pages are loaded, as a page's linked references are (#285):
   * `through` the title of the last page loaded, or null for the first
   * chunk; `next` the `through` that loads a chunk more, or null when every
   * page is loaded.
   */
  list: { through: string | null; next: string | null };
};

/**
 * The channels, named as they were when they were the graph's: the names
 * are on the wire, and moving the code is no reason to change them.
 */
export const TASKS_CHANNELS = {
  tasks: 'graph:tasks',
  filterMenu: 'graph:filter-menu',
} as const;

/**
 * What the preload bridge exposes for Tasks, on `window.pbnotes.tasks`. No
 * call names a project: main holds which one is open.
 */
export type TasksApi = {
  /**
   * Every task that meets `filter` (#387), its pages loaded `through` a
   * title (`TaskView.list`), or just the first chunk without one.
   */
  tasks(filter: Filter, through?: string): Promise<TaskView>;
  /**
   * Pops up what can be added to `filter`, under the `+ Filter` at `at`, in
   * window coordinates: each kind of condition, and under it what it can
   * take, ticked for what `filter` holds already. Resolves with the one
   * picked, to turn on or off, or null when the menu closed with nothing.
   */
  filterMenu(at: { x: number; y: number }, filter: Filter): Promise<FilterPick | null>;
};
