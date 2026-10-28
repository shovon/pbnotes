/**
 * Which project is open: main's to hold, and the one door to it.
 *
 * The renderer says which once, on `projects:open`, and after that no call
 * names a project: `index.ts` hands `requireProject` and `currentProject` to
 * `pages` as what is open, and pages never learn what it is.
 *
 * Free of `electron` imports, so it runs under `node --test`; `projects-ipc.ts`
 * is only the channels in front of it.
 */
import type { Availability, Project } from "../../../../shared/projects.ts";

/** What this reads and writes of the registry, and nothing else of it. */
export type Registry = {
  getProject(id: string): Project | null;
  listProjects(): Project[];
  /** Records that `id` was opened now; null for an id it does not track. */
  touchProject(id: string): Project | null;
  removeProject(id: string): void;
};

/** Whether a directory can be reached now. Never rejects. */
export type Probe = (directory: string) => Promise<Availability>;

/**
 * `probe` is asked whether the open project's directory is there before
 * anything is handed out to write to it.
 *
 * `onMoved` is told that the open project is now a different one, and not
 * which: whoever wires this to what a project contains already knows how to
 * ask, and nothing here imports what it would be telling.
 */
export function createOpenProject(
  registry: Registry,
  probe: Probe,
  onMoved: () => void,
) {
  /**
   * Only the session's choice is kept here. Null falls through to whichever was
   * opened most recently — on the assumption that someone who was working in a
   * project on Friday is still working in it on Monday — and so does a project
   * removed from under the view. `last_opened_at` is the only record of that,
   * so it doubles as the restored session; nothing separate is persisted.
   *
   * ponytail: one per call, and the app makes one, which is right for the one
   * window it creates. Key it by `webContents` if a second window ever shows
   * another project.
   */
  let openId: string | null = null;

  function currentProject(): Project | null {
    return (
      (openId && registry.getProject(openId)) ||
      registry
        .listProjects()
        .sort((a, b) =>
          (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""),
        )[0] ||
      null
    );
  }

  /**
   * The one door to the open project's ledger. The log lives in the project's
   * directory, so that needs a directory that is actually there.
   *
   * The reachability check is not politeness: opening a ledger creates its
   * directory, so writing to an unmounted drive would invent the whole path on
   * the local disk and put the user's notes somewhere the real volume hides the
   * moment it comes back.
   *
   * Which project is read before the first `await`, so it is settled the moment
   * this is called. Whatever writes calls it first for that reason: a write
   * sent just before the project changed still lands where it was typed.
   */
  async function requireProject(): Promise<Project> {
    const project = currentProject();
    if (!project) throw new Error("No project is open");

    if ((await probe(project.path)) !== "available") {
      throw new Error(`"${project.name}" is not reachable right now.`);
    }
    return project;
  }

  /**
   * Runs `change`, and says so if a different project is open after it. Asked
   * of `currentProject` on both sides rather than of `openId`: removing the
   * open project changes which one is open without anything being opened.
   */
  function moving<T>(change: () => T): T {
    const before = currentProject()?.id;
    const result = change();
    if (currentProject()?.id !== before) onMoved();
    return result;
  }

  /**
   * Makes `id` the open project, and records when for ordering the list. Kept
   * only if it is one the registry tracks: `currentProject` would fall through
   * an unknown id anyway, and silently showing some other project is worse
   * than saying so.
   */
  function open(id: string): void {
    moving(() => {
      if (!registry.touchProject(id)) throw new Error("No such project");
      openId = id;
    });
  }

  /** Stops tracking `id`. If it was open, the next most recent one is. */
  function remove(id: string): void {
    moving(() => registry.removeProject(id));
  }

  return { currentProject, requireProject, open, remove };
}

export type OpenProject = ReturnType<typeof createOpenProject>;
