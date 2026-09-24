import { useCallback, useEffect, useState } from 'react';
import type { Availability, Project } from '../../shared/projects';
import ProjectPicker from '../ProjectPicker/ProjectPicker';
import ProjectView from '../project/ProjectView';
import Welcome from '../Welcome/Welcome';
import type { Act } from '../ui';

const { projects: api } = window.gnotes;

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

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [availability, setAvailability] = useState<Record<string, Availability>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  /**
   * The view renders from the database immediately; reachability is filled in
   * afterwards so a sleeping network share cannot hold up the first paint.
   * `loading` clears on both paths — a failed list must not leave the app
   * showing "Loading…" with no way out.
   */
  const refresh = useCallback(async (): Promise<Project[]> => {
    try {
      const next = await api.list();
      setProjects(next);
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
    (id: string) => {
      setOpenId(id);
      act(() => api.touch(id));
    },
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

  /**
   * Which project is showing is ordinary state. The window has no address bar
   * and nobody reloads it, so there is no URL for a router to own; when there
   * is an external `gnotes://` link to honour, this becomes the route.
   *
   * Held as an id resolved against the current list, not as a captured
   * project: a rename then shows through, and a project removed from under the
   * view falls through to whichever was open most recently — on the assumption
   * that someone who was working in a project on Friday is still working in it
   * on Monday. `last_opened_at` is the only record of that, so it doubles as
   * the restored session; nothing separate is persisted.
   */
  const project =
    projects.find((p) => p.id === openId) ??
    [...projects].sort((a, b) =>
      (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''),
    )[0] ??
    null;

  return (
    <main className="app">
      {project && (
        <ProjectPicker
          projects={projects}
          projectId={project.id}
          onSelect={openProject}
          onAdd={addProjects}
        />
      )}

      {notice && (
        <p className="notice" onClick={() => setNotice(null)}>
          {notice}
        </p>
      )}

      {project ? (
        <ProjectView
          // Remounted per project, so nothing survives the switch: the page,
          // the open editor and the block id it is editing all belong to the
          // project that was showing a moment ago.
          key={project.id}
          project={project}
          availability={availability[project.id] ?? 'available'}
          act={act}
        />
      ) : (
        !loading && <Welcome onAdd={addProjects} />
      )}
    </main>
  );
}
