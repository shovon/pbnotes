/**
 * Every task in the project (#387): the blocks whose text starts with a
 * marker (`tasks.ts`), read off the folded blocks. Takes the state alone,
 * since it writes nothing.
 */
import * as forest from "../forest/forest.ts";
import { shownOrder } from "../blocks/queries.ts";
import { textOf, treeOf } from "../blocks/blocks.ts";
import type { Block, BlockState, Page } from "../blocks/blocks.ts";
import { spelled } from "../titles/titles.ts";
import { readTask } from "./tasks.ts";
import type { Marker } from "./tasks.ts";

/** What `getTasks` reads: the pages cut down to their tasks, and how many there are. */
export type Tasks = {
  /**
   * Every page with a task under one of the markers asked for, cut down to
   * those tasks, each with its subtree, in the order pages are listed
   * (`shownOrder`), as linked references are.
   */
  pages: Page[];
  /** How many blocks are tasks under one of the markers asked for. */
  shown: number;
  /** How many blocks are tasks at all, under any marker. */
  total: number;
};

/**
 * The tasks under `markers`, page by page. A task is taken whole, with
 * everything under it, and not searched inside: a task nested in one
 * already taken shows there, not a second time on its own. One whose
 * parent is not taken (not a task, or under a marker left out) is taken
 * where it is, with nothing above it, as a linked reference is.
 *
 * ponytail: walks every block per call. The test is a regular expression
 * on the start of the text, never a Markdown parse, so it is cheap next to
 * `getReferences`; keep a set of task ids in the fold if it ever shows.
 */
export function getTasks(state: BlockState, markers: ReadonlySet<Marker>): Tasks {
  let shown = 0;
  let total = 0;
  const marked = (id: string) => {
    const task = readTask(textOf(state, id) ?? "");
    if (!task) return false;
    total++;
    if (!markers.has(task.marker)) return false;
    shown++;
    return true;
  };
  /** The tasks under `ids`, and every task inside them counted. */
  const cut = (ids: readonly string[]): Block[] =>
    ids.flatMap((id) => {
      const taken = marked(id);
      const inside = cut(forest.childrenOf(state.forest, id));
      return taken ? [treeOf(state, id)!] : inside;
    });
  const pages = [...forest.groups(state.forest)]
    .map((key) => ({ title: spelled(state.titles, key), blocks: cut(forest.rootsOf(state.forest, key)) }))
    .filter((page) => page.blocks.length > 0)
    .sort((a, b) => shownOrder(a.title, b.title));
  return { pages, shown, total };
}
