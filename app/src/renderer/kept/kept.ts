/**
 * The bench, as `Kept` values for the project that is mounted: the one place
 * in the renderer that names the bench or a slot. `App` makes them per
 * mounted `ProjectView` and turns them off when it unmounts, so a view never
 * holds anything that could reach another project's bench.
 *
 * Pure over the bench it is handed, so it runs under `node --test`.
 */
import type { BenchApi } from '../../shared/bench.ts';
import { SIDEBAR_SLOTS } from '../../shared/sidebar.ts';
import type { SidebarState } from '../../shared/sidebar.ts';
import type { Kept } from '../project/ProjectView.tsx';

type Bench = Pick<BenchApi, 'get' | 'set'>;

/** A check of what crossed the bridge: the value, or undefined. */
type Check<T> = (raw: unknown) => T | undefined;

/** A `Kept` that can be turned off, and its switch. */
export type Switchable<T> = { kept: Kept<T>; off(): void };

/**
 * One slot of the bench as a `Kept`. What crosses the bridge is `unknown`,
 * so it is checked here as well as in main. Turned off, a save does nothing
 * and a load (one in flight included) gives undefined. A failure reaches
 * `report` and costs only the convenience: a load that fails gives
 * undefined.
 */
export function keptOnBench<T>(
  bench: Bench,
  slot: string,
  check: Check<T>,
  report: (error: unknown) => void,
): Switchable<T> {
  let on = true;
  return {
    kept: {
      load: async () => {
        if (!on) return undefined;
        try {
          const raw = await bench.get(slot);
          return on ? check(raw) : undefined;
        } catch (error) {
          if (on) report(error);
          return undefined;
        }
      },
      save: (value) => {
        if (on) bench.set(slot, value).catch(report);
      },
    },
    off: () => {
      on = false;
    },
  };
}

/** A list of titles. */
export const titles: Check<string[]> = (raw) =>
  Array.isArray(raw) && raw.every((item) => typeof item === 'string') ? raw : undefined;

/** Whether the sidebar, or its Recent section, is collapsed. */
export const sidebarState: Check<SidebarState> = (raw) => {
  const collapsed = (raw as { collapsed?: unknown } | null)?.collapsed;
  return typeof collapsed === 'boolean' ? { collapsed } : undefined;
};

/** What a mounted `ProjectView` keeps, and the one switch that turns it all off. */
export function sidebarKept(bench: Bench, report: (error: unknown) => void) {
  const recent = keptOnBench(bench, SIDEBAR_SLOTS.recentPages, titles, report);
  const sidebar = keptOnBench(bench, SIDEBAR_SLOTS.sidebar, sidebarState, report);
  const section = keptOnBench(bench, SIDEBAR_SLOTS.recentSection, sidebarState, report);
  return {
    recentPages: recent.kept,
    sidebar: sidebar.kept,
    recentSection: section.kept,
    off: () => {
      recent.off();
      sidebar.off();
      section.off();
    },
  };
}
