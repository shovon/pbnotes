/**
 * The preload side of Tasks: its two calls, each sent over its channel.
 * Built from the `invoke` it is handed, so it imports nothing from
 * `electron` and the preload script is the one place that names
 * `ipcRenderer`.
 */
import { TASKS_CHANNELS } from './contract';
import type { TasksApi } from './contract';

/** Sends a call to main over `channel` and resolves with its reply: `ipcRenderer.invoke`. */
type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export function tasksBridge(invoke: Invoke): TasksApi {
  return {
    tasks: (filter, through) => invoke(TASKS_CHANNELS.tasks, filter, through) as ReturnType<TasksApi['tasks']>,
    filterMenu: (at, filter) =>
      invoke(TASKS_CHANNELS.filterMenu, at, filter) as ReturnType<TasksApi['filterMenu']>,
  };
}
