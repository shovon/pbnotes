/**
 * Every task that meets a filter (#387): the fold, read for one window, as
 * `getView` reads a place. Pure: it reads the fold it is handed and holds
 * nothing.
 */
import { getPreviews, getTasks } from "@pbnotes/graph";
import type { Graph } from "@pbnotes/graph";
import type { Filter, TaskView } from "../../../../../shared/graph.ts";
import { markersOf } from "../filter/filter.ts";
import { cuts } from "../place-view/place-view.ts";

/**
 * The tasks that meet `filter`, page by page, labelled with `version`, and
 * loaded a chunk at a time as a page's linked references are (#285): every
 * page up to and including the one titled `through`, or the first chunk
 * without one, so the view has something to draw at once. Read in one
 * turn, so the label and the content cannot disagree.
 */
export function getTaskView(
  view: { readonly state: Graph; readonly version: number },
  filter: Filter,
  through?: string,
): TaskView {
  const { state, version } = view;
  const { pages, shown, total } = getTasks(state, markersOf(filter));
  const first = through ?? cuts(pages, undefined).next ?? undefined;
  const loaded = cuts(pages, first);
  return {
    version,
    pages: loaded.shown,
    shown,
    total,
    previews: getPreviews(state, loaded.shown),
    list: { through: first ?? null, next: loaded.next },
  };
}
