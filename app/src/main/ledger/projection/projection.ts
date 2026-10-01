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
import { EventLog } from '../event-log/event-log.ts';
import type { LogEvent, LogOptions } from '../event-log/event-log.ts';
import type { Unhandled, ViewStatus } from '../../../shared/log.ts';

/**
 * Must be pure, and its state must survive a structured clone: the view
 * crosses to the renderer as data, and the fold may one day run off-thread.
 * Return new state rather than mutating, which is also exactly what
 * `useSyncExternalStore` wants on the other side.
 */
export type Reducer<S> = (state: S, event: LogEvent) => S;

/**
 * Why the state moved: an event this device just appended, or a re-fold that
 * picked up something which arrived in the folder.
 *
 * The difference matters to whoever is watching. A `dispatch` is already known
 * to the caller that asked for it — `addBlock` hands the folded page straight
 * back — so telling the view about it again is at best redundant work. A
 * `refold` is the only kind the view could not have known about, because
 * nothing local caused it.
 */
export type Change = 'dispatch' | 'refold';

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
  /** Events in the current fold. Compared to spot a re-fold that read the
      same bytes, which the poll behind `watch` does every 30 seconds. */
  #counted: number;
  #listeners = new Set<(state: S, change: Change) => void>();
  #unwatch: (() => void) | undefined;

  private constructor(
    log: EventLog,
    fold: { state: S; unhandled: Unhandled[]; count: number },
    reduce: Reducer<S>,
    options: ProjectionOptions,
    initial: S,
  ) {
    this.#log = log;
    this.#state = fold.state;
    // What the fold *started* from, not what it arrived at. `fold.state` has
    // the entire log in it by the time this runs, and a refold onto that is
    // how every event already on disk at open gets folded a second time — for
    // a reducer that appends (every block in a page), a doubled view.
    this.#initial = initial;
    this.#unhandled = fold.unhandled;
    this.#counted = fold.count;
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
    return new Projection(log, fold, reduce, options, initial);
  }

  /**
   * A fold in progress: somewhere to put the state as events arrive, and a
   * tally of the ones the reducer could not use.
   */
  static #folder<S>(
    reduce: Reducer<S>,
    initial: S,
    handles: Record<string, number> | undefined,
  ): {
    apply: (event: LogEvent) => void;
    state: S;
    unhandled: Unhandled[];
    count: number;
  } {
    const tally = new Map<string, Unhandled>();
    const fold = {
      state: initial,
      unhandled: [] as Unhandled[],
      /** How many events went in, which is how a repeat fold is recognised. */
      count: 0,
      apply(event: LogEvent): void {
        fold.count += 1;
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

  /** The device the log writes as — after a rotation, the new one. */
  get device(): string {
    return this.#log.device;
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
    // The poll behind `watch` re-folds on a timer whether or not anything
    // arrived, and most of the time nothing has. The log is append-only, so the
    // same number of events is the same events: an unchanged count is an
    // identical fold, and listeners hear about the folder changing rather than
    // about it being read again.
    if (fold.count === this.#counted) return;
    this.#counted = fold.count;
    this.#notify('refold');
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
    // Folded here rather than by a replay, so the tally has to be told — left
    // behind, the next re-fold counts one more event than it did and reports
    // this device's own write as something that arrived.
    this.#counted += 1;
    this.#notify('dispatch');
    return event;
  }

  #notify(change: Change): void {
    for (const listener of this.#listeners) listener(this.#state, change);
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: (state: S, change: Change) => void): () => void {
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
