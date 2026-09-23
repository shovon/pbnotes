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
import type { LogEvent, LogOptions } from './event-log.ts';
import type { Unhandled, ViewStatus } from '../shared/log.ts';

/**
 * Must be pure, and its state must survive a structured clone: the view
 * crosses to the renderer as data, and the fold may one day run off-thread.
 * Return new state rather than mutating, which is also exactly what
 * `useSyncExternalStore` wants on the other side.
 */
export type Reducer<S> = (state: S, event: LogEvent) => S;

export type ProjectionOptions = LogOptions & {
  /**
   * Event type → the highest payload `v` the reducer understands.
   *
   * Under one writer this could not matter: a log only ever held events the
   * build that wrote it knew about. With several machines in a folder, an
   * older build routinely reads what a newer one wrote, and `reduce` ends in a
   * bare `return state` — so it would render an incomplete page and say
   * nothing. Skipping stays the behaviour, because refusing to open would let
   * one new event type on one machine lock the user out of their notes
   * everywhere. Counting is what turns it from silent into visible.
   */
  handles?: Record<string, number>;
};

export class Projection<S> {
  #log: EventLog;
  #state: S;
  #initial: S;
  #reduce: Reducer<S>;
  #options: ProjectionOptions;
  #unhandled: Unhandled[];
  #listeners = new Set<(state: S) => void>();
  #unwatch: (() => void) | undefined;

  private constructor(
    log: EventLog,
    fold: { state: S; unhandled: Unhandled[] },
    reduce: Reducer<S>,
    options: ProjectionOptions,
  ) {
    this.#log = log;
    this.#state = fold.state;
    this.#initial = fold.state;
    this.#unhandled = fold.unhandled;
    this.#reduce = reduce;
    this.#options = options;
  }

  /**
   * Replays the log in `directory` — every segment, in order — into `initial`,
   * then stays open for dispatching.
   */
  static async open<S>(
    directory: string,
    reduce: Reducer<S>,
    initial: S,
    options: ProjectionOptions = {},
  ): Promise<Projection<S>> {
    const fold = Projection.#folder(reduce, initial, options.handles);
    // ponytail: the whole log is folded on the main thread at startup. Move
    // reduce to a worker, or cache the state alongside the log tagged with the
    // `seq` *per device* it is valid through, if this ever shows up as a slow
    // launch. That cache belongs in `userData`, never in the shared folder.
    const log = await EventLog.open(directory, fold.apply, options);
    return new Projection(log, fold, reduce, options);
  }

  /**
   * A fold in progress: somewhere to put the state as events arrive, and a
   * tally of the ones the reducer could not use.
   */
  static #folder<S>(
    reduce: Reducer<S>,
    initial: S,
    handles: Record<string, number> | undefined,
  ): { apply: (event: LogEvent) => void; state: S; unhandled: Unhandled[] } {
    const tally = new Map<string, Unhandled>();
    const fold = {
      state: initial,
      unhandled: [] as Unhandled[],
      apply(event: LogEvent): void {
        if (handles && !(event.v <= (handles[event.type] ?? -1))) {
          const key = `${event.type}@${event.v}`;
          const seen = tally.get(key);
          if (seen) seen.count += 1;
          else {
            const it = { type: event.type, v: event.v, count: 1 };
            tally.set(key, it);
            fold.unhandled.push(it);
          }
        }
        fold.state = reduce(fold.state, event);
      },
    };
    return fold;
  }

  get state(): S {
    return this.#state;
  }

  /** The last event *this device* wrote. Other devices count separately. */
  get seq(): number {
    return this.#log.seq;
  }

  /** How much of the folder was readable, and what the fold could not use. */
  get status(): ViewStatus {
    return { ...this.#log.status, unhandled: this.#unhandled };
  }

  /**
   * Rebuilds the view from the whole folder.
   *
   * From scratch, not extended: another device's event can sort anywhere,
   * including before events already folded, so there is no tail to append.
   * The price is that a late arrival reshuffles the page under the user, which
   * is what a shared folder costs.
   */
  async refold(): Promise<void> {
    const fold = Projection.#folder(
      this.#reduce,
      this.#initial,
      this.#options.handles,
    );
    await this.#log.replay(fold.apply);
    this.#state = fold.state;
    this.#unhandled = fold.unhandled;
    for (const listener of this.#listeners) listener(this.#state);
  }

  /**
   * Re-folds whenever anything in the folder changes, until the returned
   * function is called.
   *
   * Not optional garnish once the folder is shared: without it, another
   * machine's notes do not appear until the app restarts, because the log is
   * read exactly once at open.
   */
  watch(): () => void {
    this.#unwatch?.();
    let running = false;
    this.#unwatch = this.#log.watch(() => {
      // A re-fold that overruns the next change simply folds again; two of
      // them at once would race over `#state`.
      if (running) return;
      running = true;
      void this.refold().finally(() => {
        running = false;
      });
    });
    return this.#unwatch;
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
    this.#unwatch?.();
    this.#listeners.clear();
    await this.#log.close();
  }
}
