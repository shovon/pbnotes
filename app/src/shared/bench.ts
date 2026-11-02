/**
 * The bench contract: channel names and the surface on `window.pbnotes.bench`.
 * Bundled into the renderer too, so it stays free of `node:` imports.
 *
 * No call names a project: main keeps each slot for whichever project is open.
 * Which slots there are, and what each holds, is the product's to declare.
 */

export const BENCH_CHANNELS = {
  get: 'bench:get',
  set: 'bench:set',
} as const;

/** The surface exposed on `window.pbnotes.bench` by the preload bridge. */
export type BenchApi = {
  /** The slot's value for the open project, or undefined when there is none. */
  get(slot: string): Promise<unknown>;
  /** Keeps `value` in the slot for the open project. */
  set(slot: string, value: unknown): Promise<void>;
};
