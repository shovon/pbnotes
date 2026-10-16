/**
 * Each project's ledger, opened once, and the pages fold running over it.
 *
 * `@pbnotes/append-only-log` opens one folder and folds it; which folders are
 * open, what happens when one moves, and how a write reaches the view before
 * its reply does are the app's, and live here. Shell, not a feature: `pages/`
 * is handed the view this builds and never sees a ledger or a path.
 *
 * Deliberately free of `electron` imports, so `pages-store.test.ts` can run
 * it under `node --test`.
 */
import path from "node:path";
import { openOrCreate } from "@pbnotes/append-only-log";
import type { Ledger } from "@pbnotes/append-only-log";
import { pagesFold } from "./features/projects/pages/pages-store/pages-store.ts";
import type { PagesView } from "./features/projects/pages/pages-store/pages-store.ts";

/** Enough to find a ledger: what to remember it by, and the folder it is. */
export type LedgerRef = { id: string; path: string };

type Opened = { ledger: Ledger; view: PagesView };

/**
 * Holding the *promise*, so two overlapping opens of one project share one
 * ledger, and with it one writer. Remembering the path, because the log
 * travels with the folder and a project that moved is a different ledger.
 */
type Entry = { path: string; opened: Promise<Opened> };

const entries = new Map<string, Entry>();

/**
 * Told which project's pages changed: an arrival from another session, or a
 * fold that caught up with a write of our own. One listener; a second call
 * replaces the first. Left unset, nobody is told, which is what a test wants.
 */
let announce: ((projectId: string) => void) | undefined;

export function onChange(next: (projectId: string) => void): void {
  announce = next;
}

async function open(project: LedgerRef): Promise<Opened> {
  // `openOrCreate` is the app's policy already: a missing or empty folder is
  // made a ledger, and anything else that is not one is refused.
  const ledger = await openOrCreate(project.path);
  const fold = ledger.onEvent(pagesFold.initial, pagesFold.reduce);
  const states = fold[Symbol.asyncIterator]();
  // The first yield is the catch-up, so the view has every page before it is
  // handed out.
  let state = (await states.next()).value as PagesView["state"];

  // Every later yield is the truth, including one that refolded the past.
  // A yield that is the state already held changes nothing on screen.
  //
  // ponytail: a yield computed just before our own `post` landed can arrive
  // just after `dispatch` folded it in, and briefly drop it until the next
  // yield. Needs an arrival in the same tick as a write; carry an event count
  // in the fold state if it ever shows.
  void (async () => {
    for (let next; !(next = await states.next()).done; ) {
      if (next.value === state) continue;
      state = next.value;
      announce?.(project.id);
    }
  })();

  const view: PagesView = {
    get state() {
      return state;
    },
    get status() {
      return ledger.status;
    },
    // The event is folded in here, before this resolves, so the state sent
    // before the reply already holds it: the renderer drops its prediction
    // when the write settles, and a state without it would make the block
    // jump back for a frame.
    async dispatch(v, type, payload) {
      const event = await ledger.writer().post(v, type, payload);
      state = pagesFold.reduce(state, event);
    },
  };
  return { ledger, view };
}

async function release(entry: Entry): Promise<void> {
  try {
    await (await entry.opened).ledger.close();
  } catch {
    // A ledger that never opened has nothing to close.
  }
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

export async function pagesOf(project: LedgerRef): Promise<PagesView> {
  return (await opened(project)).view;
}

/**
 * The directory this session writes in, by name, for what is kept beside the
 * segments without an event. It appears on the first `post` or the first file
 * saved into it, whichever comes first.
 */
export async function writerOf(project: LedgerRef): Promise<string> {
  return path.basename((await opened(project)).ledger.writer().directory);
}

export async function closeLedgers(): Promise<void> {
  const open = [...entries.values()];
  entries.clear();
  await Promise.all(open.map(release));
}
