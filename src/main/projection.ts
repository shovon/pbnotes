/**
 * A projection: the in-memory view folded out of an event log.
 *
 * Folding happens here, in main, and only here. The renderer is handed the
 * result and never replays anything itself — one folder means one place for
 * the view to be wrong, and it keeps the option of moving the fold to a worker
 * thread later.
 *
 * Two paths produce the view: replaying the log at startup, and folding each
 * new event as it is appended. They are the same `reduce` function, called
 * from the two places in this file, because a view that is rebuilt differently
 * from how it is maintained drifts — and the drift only shows up the next
 * morning, on someone else's machine, with no reproduction.
 *
 * Deliberately free of `electron` imports so it stays runnable under plain
 * `node --test`, and portable to a worker.
 */
import { EventLog } from './event-log.ts';
import type { LogEvent } from './event-log.ts';

/**
 * Must be pure, and its state must survive a structured clone: the view
 * crosses to the renderer as data, and the fold may one day run off-thread.
 * Return new state rather than mutating, which is also exactly what
 * `useSyncExternalStore` wants on the other side.
 */
export type Reducer<S> = (state: S, event: LogEvent) => S;

export class Projection<S> {
  #log: EventLog;
  #state: S;
  #reduce: Reducer<S>;
  #listeners = new Set<(state: S) => void>();

  private constructor(log: EventLog, state: S, reduce: Reducer<S>) {
    this.#log = log;
    this.#state = state;
    this.#reduce = reduce;
  }

  /**
   * Replays the log in `directory` — every segment, in order — into `initial`,
   * then stays open for dispatching.
   */
  static async open<S>(
    directory: string,
    reduce: Reducer<S>,
    initial: S,
  ): Promise<Projection<S>> {
    let state = initial;
    // ponytail: the whole log is folded on the main thread at startup. Move
    // reduce to a worker, or cache the state alongside the log tagged with the
    // seq it is valid through, if this ever shows up as a slow launch.
    const log = await EventLog.open(directory, (event) => {
      state = reduce(state, event);
    });
    return new Projection(log, state, reduce);
  }

  get state(): S {
    return this.#state;
  }

  /** The last event folded in. The tag a cached projection would carry. */
  get seq(): number {
    return this.#log.seq;
  }

  /**
   * Records what the user did, then folds it in. In that order: the append has
   * to be durable before the view admits it happened, so a rejected write
   * leaves the view exactly as it was and the caller sees the error.
   */
  async dispatch<T>(type: string, payload: T, v = 1): Promise<LogEvent<T>> {
    const event = await this.#log.append(type, payload, v);
    this.#state = this.#reduce(this.#state, event as LogEvent);
    for (const listener of this.#listeners) listener(this.#state);
    return event;
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: (state: S) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.#listeners.clear();
    await this.#log.close();
  }
}
