/**
 * Which project is open: main's to hold, and the one door to it.
 *
 * The renderer says which once, on `projects:open`, and after that no call
 * names a project: `index.ts` hands `requireProject` and `currentProject` to
 * `graph` as what is open, and the graph never learns what it is.
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
 * Opens a project's ledger, or rejects with why it can't be: a folder the
 * ledger refuses, or a log damaged past what it reads. What it resolves with
 * is not looked at.
 */
export type Load = (project: Project) => Promise<unknown>;

/**
 * `probe` is asked whether a project's directory is there before its ledger is
 * opened, and before anything is handed out to write to it.
 *
 * `load` opens a project's ledger before it is made the open one (#393), so a
 * project that can't be opened says so to whoever asked to open it, and
 * leaves the one open before it as it was.
 *
 * `onMoved` is told that the open project is now a different one, and not
 * which: whoever wires this to what a project contains already knows how to
 * ask, and nothing here imports what it would be telling.
 */
export function createOpenProject(
  registry: Registry,
  probe: Probe,
  load: Load,
  onMoved: () => void,
) {
  /**
   * Only the session's choice is kept here. Null is no project open: the app
   * starts with none, and is back to none when the open one is removed. The
   * window opens the one opened most recently (`lastOpenedAt`) itself, through
   * `open`, so a project that can't be opened is told the same way at launch
   * as any other time (#393), rather than half-opened by default.
   *
   * ponytail: one per call, and the app makes one, which is right for the one
   * window it creates. Key it by `webContents` if a second window ever shows
   * another project.
   */
  let openId: string | null = null;
  /** How many opens were asked for: only the last one asked takes effect. */
  let asked = 0;

  function currentProject(): Project | null {
    return (openId && registry.getProject(openId)) || null;
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
   * Makes `id` the open project, once its folder is there and its ledger
   * opens, and records when for ordering the list. Rejects, and leaves the
   * open project as it was, for an id the registry does not track, a folder
   * that can't be reached, and a ledger that won't open. A second open asked
   * for before this one settles wins: this one then changes nothing.
   *
   * The probe comes first for the reason `requireProject` gives: opening a
   * ledger on a folder that isn't there would create it.
   */
  async function open(id: string): Promise<void> {
    const turn = ++asked;
    const project = registry.getProject(id);
    if (!project) throw new Error("No such project");
    if ((await probe(project.path)) !== "available") {
      throw new Error(`"${project.name}" is not reachable right now.`);
    }
    await load(project);
    if (turn !== asked) return;
    moving(() => {
      if (!registry.touchProject(id)) throw new Error("No such project");
      openId = id;
    });
  }

  /** Stops tracking `id`. If it was open, none is. */
  function remove(id: string): void {
    moving(() => registry.removeProject(id));
  }

  return { currentProject, requireProject, open, remove };
}

export type OpenProject = ReturnType<typeof createOpenProject>;
