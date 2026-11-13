/**
 * When the Tasks view (#387) asks main for its tasks, and which answer it
 * keeps: the place fetcher's rules (`fetcher/`), for a filter rather than a
 * place. It asks when the filter changes, and on hearing the fold reached a
 * version the answer it holds lacks, unless a fetch already on its way
 * covers it.
 *
 * It holds how far the pages are loaded, as a page's linked references are
 * (#285): main picks the first `through`, the fetcher keeps asking for that
 * one so a change never shrinks the list under the scroll, and `more` moves
 * it on. A new filter starts over.
 *
 * Built from what it reaches outside, so a test can hand it a fake `tasks`
 * whose answers arrive late, out of order, or not at all.
 */
import type { Filter, TaskView } from '../../../../shared/graph.ts';

export type TaskFetcherPorts = {
  /** Asks main for the tasks that meet a filter, loaded `through` a title. */
  tasks: (filter: Filter, through: string | undefined) => Promise<TaskView>;
  /** The filter the view is on now. */
  filter: () => Filter;
  /** A new answer to draw. */
  onAnswer: (view: TaskView) => void;
  /** A fetch failed. */
  onError: (error: unknown) => void;
};

export type TaskFetcher = {
  /** The filter changed, or the view first opened: ask for it. */
  moved: () => void;
  /** The fold reached `v`: a notice from main, or a write's reply. */
  heard: (v: number) => void;
  /** More pages are wanted: the chunk main said comes next. */
  more: () => void;
};

/** Two filters asking for the same: compared as they would be sent. */
const same = (a: Filter, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

export function createTaskFetcher({ tasks, filter, onAnswer, onError }: TaskFetcherPorts): TaskFetcher {
  /** The answer drawn, and the filter it was asked for. */
  let held: { filter: Filter; view: TaskView } | null = null;
  /** The highest fold version heard of. */
  let known = 0;
  /** The highest version a fetch already asked for is sure to reach. */
  let covered = 0;
  /** How far the pages are loaded, or undefined until main first says. */
  let through: string | undefined;

  const ask = () => {
    const on = filter();
    const asked = through;
    covered = known;
    tasks(on, asked).then(
      (answer) => {
        // Asked for a filter the view has since left: never drawn.
        if (!same(on, filter())) return;
        if (asked === undefined && through === undefined) {
          through = answer.list.through ?? undefined;
        } else if (asked !== through) {
          // Read for a list loaded less far, or further, than it is now:
          // the fetch for this one is on its way, or is asked for now.
          if (answer.version > (held?.view.version ?? 0)) ask();
          return;
        }
        if (held && same(held.filter, on) && held.view.version > answer.version) return;
        held = { filter: on, view: answer };
        onAnswer(answer);
      },
      (error: unknown) => {
        covered = 0;
        onError(error);
      },
    );
  };

  return {
    moved: () => {
      through = undefined;
      ask();
    },
    heard: (v) => {
      known = Math.max(known, v);
      if (held && same(held.filter, filter()) && held.view.version >= v) return;
      if (covered >= v) return;
      ask();
    },
    more: () => {
      const next = held && same(held.filter, filter()) ? held.view.list.next : null;
      if (!next || next === through) return;
      through = next;
      ask();
    },
  };
}
