import { useCallback, useEffect, useState } from 'react';
import type { PagesApi } from '../../shared/pages';
import type { Availability, Project, ProjectsApi } from '../../shared/projects';
import ProjectPicker from '../ProjectPicker/ProjectPicker';
import ProjectView from '../project/ProjectView';
import Welcome from '../Welcome/Welcome';
import type { Act } from '../ui';

/**
 * Handed in by the composition root (`index.tsx`), never read off `window`.
 * Only the project calls this view makes; `pages` is passed on to the
 * project that is open.
 */
type Props = {
  projects: Pick<ProjectsApi, 'list' | 'current' | 'availability' | 'open' | 'pick'>;
  pages: PagesApi;
  /** The clock, passed on to the project that is open. */
  now: () => Date;
};

/**
 * Main rejects with messages meant for the user to read ("That directory is
 * already tracked as …"), but Electron wraps them in its own IPC prefix on the
 * way across. Strip the plumbing and keep the sentence.
 */
function humanize(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/,
    '',
  );
}

export default function App({ projects: api, pages, now }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [availability, setAvailability] = useState<Record<string, Availability>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Which project is open is main's to say, and this is its answer as last
   * read. There is no address bar and nobody reloads the window, so there is
   * no URL for a router to own; when there is an external `pbnotes://` link
   * to honour, main is where it lands.
   */
  const [project, setProject] = useState<Project | null>(null);

  /**
   * The view renders from the database immediately; reachability is filled in
   * afterwards so a sleeping network share cannot hold up the first paint.
   * `loading` clears on both paths — a failed list must not leave the app
   * showing "Loading…" with no way out.
   */
  const refresh = useCallback(async (): Promise<Project[]> => {
    try {
      // Together, so a rename shows through in the picker and the page at
      // once, and a project removed from under the view takes it along.
      const [next, current] = await Promise.all([api.list(), api.current()]);
      setProjects(next);
      setProject(current);
      setLoading(false);
      setAvailability(
        next.length > 0 ? await api.availability(next.map((p) => p.id)) : {},
      );
      return next;
    } catch (error) {
      setNotice(humanize(error));
      setLoading(false);
      return [];
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Every button in every view reaches main, and every one of those calls can
   * reject — relocating onto an already-tracked directory does exactly that.
   * Unhandled, the rejection is silent and the click looks like a no-op.
   */
  const run = useCallback(async (action: () => Promise<void>) => {
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(humanize(error));
    }
  }, []);

  /**
   * Anything that changes a project re-reads the list rather than patching the
   * row in place: a rename has to show through in the picker, and a removal
   * has to take the open project with it.
   */
  const act = useCallback<Act>(
    (action) =>
      void run(async () => {
        await action();
        await refresh();
      }),
    [run, refresh],
  );

  const openProject = useCallback(
    (id: string) => act(() => api.open(id)),
    [act],
  );

  /**
   * Adding opens what was added: the only reason to pick a directory is to
   * write in it, and making that a second click would be a page in disguise.
   */
  const addProjects = useCallback(
    (): void =>
      void run(async () => {
        const result = await api.pick();
        if (result.canceled) return;

        const added = result.outcomes.filter((o) => o.status === 'added');
        const duplicates = result.outcomes.filter(
          (outcome) => outcome.status === 'already-tracked',
        );
        const failures = result.outcomes.filter(
          (outcome) => outcome.status === 'failed',
        ).length;

        const parts: string[] = [];
        if (duplicates.length > 0) parts.push(`${duplicates.length} already tracked`);
        if (failures > 0) parts.push(`${failures} could not be read`);

        await refresh();
        setNotice(parts.length > 0 ? parts.join(' · ') : null);

        // An already-tracked directory is still the one the user just asked
        // for, so it opens too rather than leaving them where they were.
        const target = added.at(-1)?.project ?? duplicates.at(-1)?.project;
        if (target) openProject(target.id);
      }),
    [run, refresh, openProject],
  );

  return (
    <>
      {/* The window's own top strip, where the title bar used to be. The
          picker is the one control that is not about the project currently
          open, so it belongs above the page rather than on it — beside
          whichever corner the platform puts its window buttons in.

          The window buttons are laid over this same strip, and which corner
          they take is the platform's business: macOS puts them left, Windows
          and Linux right. `env(titlebar-area-*)` is the box they leave free,
          which is the whole point of `titleBarOverlay` — the fallbacks are
          macOS's own inset, for the moment before Chromium has measured the
          frame.

          That box is measured against the window, not the page, and docked
          DevTools makes the page the narrower of the two — so the strip is
          capped to the page, or it lies over the inspector's own toolbar and
          takes its clicks as drags.

          The strip's fill and rule are on a backing of their own rather than
          on the header, because the header stops short of the window buttons
          and the fill must not. The backing is sized to the page, not the
          window, so docked DevTools caps it too. Its rule hangs just below
          the measured strip rather than inside it, where the Windows and
          Linux controls, which are opaque, would paint over its right end.
          It is a handle as well: the gap beside the buttons drags too. */}
      <div
        aria-hidden
        className="app-region-drag fixed inset-x-0 top-0 z-20 box-content h-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar)))] border-b border-line bg-bg"
      />
      <header
        id="titlebar"
        className="app-region-drag fixed z-20 top-[env(titlebar-area-y,0px)] left-[env(titlebar-area-x,5rem)] flex h-[env(titlebar-area-height,var(--spacing-titlebar))] w-[env(titlebar-area-width,calc(100%-5rem))] max-w-[calc(100%-env(titlebar-area-x,5rem))] items-center"
      >
        {project && (
          <ProjectPicker
            projects={projects}
            projectId={project.id}
            onSelect={openProject}
            onAdd={addProjects}
          />
        )}
      </header>

      <main className="mx-auto box-content max-w-page px-6 pt-[calc(var(--spacing-titlebar)+--spacing(3))] pb-12">
        {notice && (
          <p
            className="mb-4 cursor-pointer rounded-md bg-warn-bg px-3 py-2 text-sm text-warn-fg"
            onClick={() => setNotice(null)}>
            {notice}
          </p>
        )}

        {project ? (
          <ProjectView
            // Remounted per project, so nothing survives the switch: the
            // state, the open editor and the block id it is editing all
            // belong to the project that was showing a moment ago. The key is
            // all the view is told about which project that is.
            key={project.id}
            availability={availability[project.id] ?? 'available'}
            act={act}
            pages={pages}
            now={now}
          />
        ) : (
          !loading && <Welcome onAdd={addProjects} />
        )}
      </main>
    </>
  );
}
