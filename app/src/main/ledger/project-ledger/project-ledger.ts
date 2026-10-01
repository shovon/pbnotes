/**
 * A project's ledger: one log per project, opened once, with every fold the
 * app defines riding on it.
 *
 * The log lives *inside the project's own directory*, and that location is
 * the point of the whole app. A project folder is where the user's work
 * already lives, so the notes about it belong beside it: they get backed up
 * with it, sync with it, travel with it to another machine, and outlive
 * pbnotes itself. Put them in `userData` instead and wiping an OS support
 * folder — or losing the registry that maps a UUID back to a path — takes the
 * writing with it. The content is the user's, not the app's.
 *
 * A slice sees none of how that is kept true. It hands `defineFold` a reducer
 * and gets back a function from a project to its view; which device this is,
 * which logs are open, and when a file arrived from elsewhere all stay here.
 *
 * Deliberately free of `electron` imports, like `projection.ts`: callers hand
 * in the project, which also keeps a slice runnable under `node --test`.
 */
import path from 'node:path';
import { Projection } from '../projection/projection.ts';
import type { Reducer } from '../projection/projection.ts';
import type { DeviceMemory } from '../event-log/event-log.ts';
import type { ViewStatus } from '../../../shared/log.ts';

/** Enough of a project to find its log. */
export type ProjectRef = {
  id: string;
  path: string;
};

/**
 * `<project>/gnotes/`, holding the numbered segments. Visible, not behind a
 * dot: a dot-directory tells the user "you can safely ignore this", which is
 * true of a tool's bookkeeping and a lie about the only copy of their notes.
 *
 * A folder rather than a loose file because the log is segmented and there
 * will be more than one of them, and because the things that come later —
 * images and whatever else a page can hold — get their own folders beside it.
 */
export function logDirectory(projectPath: string): string {
  return path.join(projectPath, 'gnotes');
}

/**
 * How this machine identifies itself in a shared folder, and where it keeps
 * what it remembers between sessions.
 *
 * Injected rather than imported so this file stays runnable under
 * `node --test`, which has no `userData` and no database. Left unset, every
 * session writes in a directory of its own: visible litter, never a lost
 * event, and exactly what a test wants.
 */
export type DeviceBinding = {
  device: string;
  recall(projectId: string): DeviceMemory;
  remember(projectId: string, memory: DeviceMemory): void;
  rotate(): string;
};

let binding: DeviceBinding | undefined;

export function bindDevice(next: DeviceBinding): void {
  binding = next;
}

/**
 * Told which project's folds moved because something arrived in its folder.
 *
 * Injected for the same reason as `bindDevice`: this file holds no `electron`
 * import, so it cannot reach a window itself. Left unset, another device's
 * events are folded and nobody is told — which is exactly what a test wants,
 * and what a headless main process would do anyway.
 */
let announce: ((projectId: string) => void) | undefined;

export function onArrival(next: (projectId: string) => void): void {
  announce = next;
}

/**
 * One subject's reading of the log: what its events fold into, and which of
 * them it understands.
 *
 * `handles` is event type → the payload `v` this build folds, which is also
 * the `v` it writes. One number for both on purpose: a build that wrote a
 * version its own gate refuses would skip its own events.
 */
export type Fold<S, T extends string = string> = {
  reduce: Reducer<S>;
  initial: S;
  handles: Record<T, number>;
};

/** A fold's slice of one project's ledger. */
export type View<S, T extends string = string> = {
  readonly state: S;
  /** The device the log writes as — after a rotation, the new one. */
  readonly device: string;
  /**
   * The whole ledger's, not this fold's: an event is unhandled only when no
   * fold in the app claims it.
   */
  readonly status: ViewStatus;
  /** Resolves once the event is durable and folded. */
  dispatch(type: T, payload: unknown): Promise<unknown>;
};

/** Every fold's state, by the name it was defined under. */
type Slices = Record<string, unknown>;

const folds = new Map<string, Fold<unknown>>();

/**
 * Every fold sees every event, and keeps its slice when the event is not one
 * of its own — which is the same `return state` a reducer already ends in.
 */
const reduce: Reducer<Slices> = (state, event) => {
  let next = state;
  for (const [name, fold] of folds) {
    const slice = fold.reduce(state[name], event);
    if (slice !== state[name]) next = { ...next, [name]: slice };
  }
  return next;
};

/**
 * Cached by project id, but remembering the path it was opened at, and
 * holding the *promise* rather than the projection — two overlapping opens of
 * one project would otherwise each end up with their own appender on one file,
 * and two appenders means two writers picking the same sequence numbers.
 */
type Entry = {
  path: string;
  projection: Promise<Projection<Slices>>;
};

const projections = new Map<string, Entry>();

async function release(entry: Entry): Promise<void> {
  try {
    await (await entry.projection).close();
  } catch {
    // A log that never opened has nothing to close.
  }
}

function projectionFor(project: ProjectRef): Promise<Projection<Slices>> {
  const cached = projections.get(project.id);
  if (cached?.path === project.path) return cached.projection;
  // Relocated since it was last opened. The log travelled with the directory,
  // so the open handle points at a file that is no longer this project's.
  if (cached) void release(cached);

  const all = [...folds];
  const entry: Entry = {
    path: project.path,
    projection: Projection.open<Slices>(
      logDirectory(project.path),
      reduce,
      Object.fromEntries(all.map(([name, fold]) => [name, fold.initial])),
      {
        // The union. Gated per fold, each one would report every other
        // subject's events as something this build cannot read.
        handles: Object.assign({}, ...all.map(([, fold]) => fold.handles)),
        device: binding?.device,
        memory: binding?.recall(project.id),
        remember: (memory) => binding?.remember(project.id, memory),
        // A new identity is this machine's, not this project's: every
        // project's log has to start writing under it from here on.
        rotate: () => {
          if (!binding) throw new Error('No device binding to rotate');
          const device = binding.rotate();
          binding = { ...binding, device };
          return device;
        },
      },
    ).then((projection) => {
      // The folder is shared, so another machine's notes can land at any
      // moment. Without this they would not appear until the app restarts.
      projection.watch();
      // And without this the fold would hold them while the window went on
      // showing what it read before them — a refresh nobody can ask for,
      // because there is nothing on screen to say the page is behind.
      //
      // Only a re-fold. This device's own writes already hand the folded
      // state back to the caller that asked for them.
      projection.subscribe((_state, change) => {
        if (change === 'refold') announce?.(project.id);
      });
      return projection;
    }),
  };
  // A log that failed to open — a damaged tail, a directory that went away
  // mid-write — must not stay cached as this project's log for the session.
  entry.projection.catch(() => {
    if (projections.get(project.id) === entry) projections.delete(project.id);
  });
  projections.set(project.id, entry);
  return entry.projection;
}

/**
 * Adds a fold to every project's ledger, and returns the way to its view of
 * one. Called once per subject, at module load.
 *
 * All of them share one log and one appender per project. A projection of its
 * own for each would be two writers in this device's directory picking the
 * same sequence numbers.
 *
 * ponytail: folds are fixed before the first log opens, because an open
 * ledger has already replayed without the newcomer. Replay again on define if
 * a fold ever has to arrive late.
 */
export function defineFold<S, T extends string>(
  name: string,
  fold: Fold<S, T>,
): (project: ProjectRef) => Promise<View<S, T>> {
  if (folds.has(name)) throw new Error(`Fold "${name}" is already defined`);
  if (projections.size > 0) {
    throw new Error(`Fold "${name}" was defined after a ledger was opened`);
  }
  folds.set(name, fold as unknown as Fold<unknown>);

  return async (project) => {
    const projection = await projectionFor(project);
    return {
      get state() {
        return projection.state[name] as S;
      },
      get device() {
        return projection.device;
      },
      get status() {
        return projection.status;
      },
      dispatch: (type, payload) =>
        projection.dispatch(type, payload, fold.handles[type]),
    };
  };
}

export async function closeLedgers(): Promise<void> {
  const open = [...projections.values()];
  projections.clear();
  await Promise.all(open.map(release));
}
