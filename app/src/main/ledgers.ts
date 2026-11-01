/**
 * Each project's ledger, opened once, and the pages fold running over it.
 *
 * `@pbnotes/ledger` opens one folder and folds it; which folders are
 * open, what happens when one moves, and how a write reaches the view before
 * its reply does are the app's, and live here. Shell, not a feature: `pages/`
 * is handed the view this builds and never sees a ledger or a path.
 *
 * Deliberately free of `electron` imports, so `pages-store.test.ts` can run
 * it under `node --test`.
 */
import path from "node:path";
import { DEFAULT_CADENCE, openOrCreate } from "@pbnotes/ledger";
import type { Cadence, Fold, Ledger } from "@pbnotes/ledger";
import { pagesFold } from "@pbnotes/pages";
import type { PagesView } from "./features/projects/pages/pages-store/pages-store.ts";

/** Enough to find a ledger: what to remember it by, and the folder it is. */
export type LedgerRef = { id: string; path: string };

/** What this module asks of a ledger: a `Ledger` is one, and a test may hand in its own. */
export type LedgerPort = Pick<Ledger, "onFold" | "reachOf" | "writer" | "status" | "pace" | "refresh" | "close">;

/** Opens the ledger in one folder, at a pace. `openOrCreate`, unless a test says otherwise. */
export type OpenLedger = (path: string, cadence: Cadence) => Promise<LedgerPort>;

type Opened = { ledger: LedgerPort; view: PagesView };

/**
 * Holding the *promise*, so two overlapping opens of one project share one
 * ledger, and with it one writer. Remembering the path, because the log
 * travels with the folder and a project that moved is a different ledger.
 */
type Entry = { path: string; opened: Promise<Opened> };

/** How often the folders are read, by whether a window has focus. */
export type Paces = { focused: Cadence; background: Cadence };

/**
 * The app's. See "The app's pace" in `packages/ledger/multi-writer.md`, which
 * these must match.
 */
const PACES: Paces = {
  focused: DEFAULT_CADENCE,
  background: {
    everyMs: 5_000,
    quietAfterMs: 5 * 60_000,
    quietEveryMs: 2 * 60_000,
  },
};

async function release(entry: Entry): Promise<void> {
  try {
    await (await entry.opened).ledger.close();
  } catch {
    // A ledger that never opened has nothing to close.
  }
}

/**
 * One set of open ledgers, and the one listener told when a project's pages
 * move. The composition root makes one and closes it; a test makes its own,
 * and may pace it its own way, or open its own ledgers.
 */
export function createLedgers(paces: Paces = PACES, openLedger: OpenLedger = openOrCreate) {
  const entries = new Map<string, Entry>();

  /**
   * Told which project's pages changed: a write of ours, an arrival from
   * another session, or a fold that caught up with a write of our own. One listener; a second call
   * replaces the first. Left unset, nobody is told, which is what a test wants.
   */
  let announce: ((projectId: string) => void) | undefined;

  function onChange(next: (projectId: string) => void): void {
    announce = next;
  }

  /**
   * The fold's version: one more every time any ledger's pages change, a
   * write of ours and an arrival alike. One counter for every ledger, so it
   * never goes back, even when a project's ledger is reopened at a new path.
   * A view reads it beside the state it labels, with no `await` between them,
   * so a view at version `n` holds every change up to `n`.
   */
  let version = 0;

  /** The pace every ledger is read at now, and the one a new one opens at. */
  let pace = paces.focused;

  /**
   * Paces every open ledger by whether a window has focus. Gaining it also
   * reads the folder of the project on screen in full, so what comes on
   * screen never lags by the background pace. The others are only paced: a
   * full read of every project kept open this session, on every focus, would
   * be paid for things nobody is looking at. A ledger still opening takes the
   * pace when it opens: the pace is read then, so the last call wins.
   */
  function setFocused(focused: boolean, onScreen?: string): void {
    pace = focused ? paces.focused : paces.background;
    for (const [projectId, entry] of entries)
      void repace(entry, focused && projectId === onScreen);
  }

  async function repace(entry: Entry, refresh: boolean): Promise<void> {
    let ledger: LedgerPort;
    try {
      ledger = (await entry.opened).ledger;
    } catch {
      return; // A ledger that failed to open is dropped by `opened`; nothing to pace.
    }
    ledger.pace(pace);
    if (refresh) await ledger.refresh();
  }

  async function open(project: LedgerRef): Promise<Opened> {
    // `openOrCreate` is the app's policy already: a missing or empty folder is
    // made a ledger, and anything else that is not one is refused.
    const ledger = await openLedger(project.path, pace);
    const fold = ledger.onFold(pagesFold.initial, pagesFold.reduce);
    const folds = fold[Symbol.asyncIterator]();
    // The first yield is the catch-up, so the view has every page before it is
    // handed out.
    const first = (await folds.next()).value as Fold<PagesView["state"]>;
    let state = first.state;
    let at = ++version;
    /** How far the last yield taken reached. */
    let held = first.reached;
    /** The reach of the last write `dispatch` folded in itself: a yield short of it lacks that write. */
    let need = 0;

    /** The pages moved: a new version, and the windows are told. */
    const moved = (next: PagesView["state"]): void => {
      state = next;
      at = ++version;
      announce?.(project.id);
    };

    // A later yield is the truth, including one that refolded the past, once
    // it reaches every write `dispatch` folded in. One short of that was
    // folded before the write was in the log: taking it would drop the write
    // under a version that claims it. Skipping it loses nothing, as the write
    // dirtied the fold and a yield that reaches it follows. A yield that is
    // the state already held changes nothing on screen.
    void (async () => {
      for (let next; !(next = await folds.next()).done; ) {
        const { state: s, reached } = next.value;
        if (reached < need) continue;
        held = reached;
        if (s === state) continue;
        moved(s);
      }
    })();

    const view: PagesView = {
      get state() {
        return state;
      },
      get version() {
        return at;
      },
      get status() {
        return ledger.status;
      },
      // The event is folded in here, before this resolves, so the version the
      // reply names already holds it: the renderer drops its prediction once
      // a view at that version arrives, and one without it would make the
      // block jump back. Announced like an arrival: a write of ours reaches
      // every window the way another device's does. Unless the fold got here
      // first: a yield already taken reaches the write, and folding it again
      // would apply it twice. The version already holds it then.
      async dispatch(v, type, payload) {
        const event = await ledger.writer().post(v, type, payload);
        const reach = ledger.reachOf(event);
        if (reach !== undefined && held >= reach) return;
        // No reach is a post a scan read and then failed on; the next scan
        // ingests it, and a yield short of it can still drop it until then.
        if (reach !== undefined) need = Math.max(need, reach);
        moved(pagesFold.reduce(state, event));
      },
    };
    return { ledger, view };
  }

  function opened(project: LedgerRef): Promise<Opened> {
    const cached = entries.get(project.id);
    if (cached?.path === project.path) return cached.opened;
    if (cached) void release(cached);

    const entry: Entry = { path: project.path, opened: open(project) };
    // A ledger that failed to open must not stay cached as this project's for
    // the session.
    entry.opened.catch(() => {
      if (entries.get(project.id) === entry) entries.delete(project.id);
    });
    entries.set(project.id, entry);
    return entry.opened;
  }

  async function pagesOf(project: LedgerRef): Promise<PagesView> {
    return (await opened(project)).view;
  }

  /**
   * The directory this session writes in, by name, for what is kept beside the
   * segments without an event. It appears on the first `post` or the first file
   * saved into it, whichever comes first.
   */
  async function writerOf(project: LedgerRef): Promise<string> {
    return path.basename((await opened(project)).ledger.writer().directory);
  }

  async function closeLedgers(): Promise<void> {
    const open = [...entries.values()];
    entries.clear();
    await Promise.all(open.map(release));
  }

  return { pagesOf, writerOf, onChange, setFocused, close: closeLedgers };
}

export type Ledgers = ReturnType<typeof createLedgers>;
