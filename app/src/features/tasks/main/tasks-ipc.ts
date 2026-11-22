import { BrowserWindow, Menu, ipcMain } from "electron";
import type { Graph } from "@pbnotes/graph";
import { readPoint, requireString } from "../../../main/ipc";
import { TASKS_CHANNELS } from "../contract";
import type { FilterPick } from "../contract";
import { markersOf, requireFilter } from "./filter/filter";
import { getTaskView } from "./task-view/task-view";

// The main side of Tasks (#387): its two channels. Each checks what arrives
// and hands it to what reads the fold (`task-view/`) or to the native menu,
// which only Electron can draw. What checks a filter and what reads the
// tasks import nothing from `electron`, and run under `node --test`.

/**
 * What is open, as Tasks reads it: the fold and the version it stands at,
 * read together. Declared here, by the one that uses it, and only the part
 * it calls; what `index.ts` hands the graph session is one of these.
 *
 * `require` rejects when what is open cannot be reached, and settles what
 * is open before its first `await`.
 */
export type Open = {
  require(): Promise<{ readonly state: Graph; readonly version: number }>;
};

export function registerTasksIpc(open: Open): void {
  // Every task that meets a filter, loaded `through` a title: any string,
  // as a page's linked references take, since it is only compared.
  ipcMain.handle(TASKS_CHANNELS.tasks, async (_event, filter: unknown, through: unknown) => {
    const held = requireFilter(filter);
    const upTo = through === undefined || through === null ? undefined : requireString(through, "through");
    return getTaskView(await open.require(), held, upTo);
  });

  // What can be added to a filter, from its `+ Filter`: each kind of
  // condition, with what it takes under it, ticked for what the filter
  // holds. Settles the way the page menu's does.
  ipcMain.handle(TASKS_CHANNELS.filterMenu, (event, at: unknown, filter: unknown) => {
    const point = readPoint(at);
    const held = requireFilter(filter);
    const markers = markersOf(held);
    const marked = held.some((it) => it.kind === "marker");
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return new Promise<FilterPick | null>((resolve) => {
      Menu.buildFromTemplate([
        {
          label: "Marker",
          submenu: (["TODO", "DOING", "DONE"] as const).map((marker) => ({
            label: marker,
            type: "checkbox",
            // No marker condition is every marker, but none is picked yet.
            checked: marked && markers.has(marker),
            click: () => resolve({ kind: "marker", marker }),
          })),
        },
      ]).popup({
        window,
        ...point,
        callback: () => setTimeout(() => resolve(null), 100),
      });
    });
  });
}
