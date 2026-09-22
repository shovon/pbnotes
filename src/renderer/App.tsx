import { useCallback, useEffect, useState } from 'react';
import type { Availability, Project } from '../shared/projects';
import ProjectsList from './ProjectsList';
import ProjectView from './ProjectView';
import type { Act } from './ui';

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
   * The list renders from the database immediately; reachability is filled in
   * afterwards so a sleeping network share cannot hold up the first paint.
   * `loading` clears on both paths — a failed list must not leave the app
   * showing "Loading…" with no way out.
   */
  const refresh = useCallback(async () => {
    try {
      const next = await api.list();
      setProjects(next);
      setLoading(false);
      setAvailability(
        next.length > 0 ? await api.availability(next.map((p) => p.id)) : {},
      );
    } catch (error) {
      setNotice(humanize(error));
      setLoading(false);
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
   * row in place: the order depends on pinned, last-opened and name, so a local
   * patch would leave a renamed project sitting in its old position.
   */
  const act = useCallback<Act>(
    (action) =>
      void run(async () => {
        await action();
        await refresh();
      }),
    [run, refresh],
  );

  const addProjects = useCallback(
    (): void =>
      void run(async () => {
        const result = await api.pick();
        if (result.canceled) return;

        const duplicates = result.outcomes.filter(
          (outcome) => outcome.status === 'already-tracked',
        ).length;
        const failures = result.outcomes.filter(
          (outcome) => outcome.status === 'failed',
        ).length;

        const parts: string[] = [];
        if (duplicates > 0) parts.push(`${duplicates} already tracked`);
        if (failures > 0) parts.push(`${failures} could not be read`);

        await refresh();
        setNotice(parts.length > 0 ? parts.join(' · ') : null);
      }),
    [run, refresh],
  );

  /**
   * Which view is showing is ordinary state. The window has no address bar and
   * nobody reloads it, so there is no URL for a router to own; when there is
   * a back stack or an external `gnotes://` link to honour, this becomes the
   * route.
   *
   * Held as an id resolved against the current list, not as a captured
   * project: a rename then shows through, and a project removed from under
   * the view drops back to the list instead of stranding the window on a row
   * that no longer exists.
   */
  const openProject = projects.find((p) => p.id === openId) ?? null;

  return (
    <main className="app">
      {notice && (
        <p className="notice" onClick={() => setNotice(null)}>
          {notice}
        </p>
      )}

      {openProject ? (
        <ProjectView
          project={openProject}
          availability={availability[openProject.id] ?? 'available'}
          act={act}
          onBack={() => setOpenId(null)}
        />
      ) : (
        <ProjectsList
          projects={projects}
          availability={availability}
          loading={loading}
          act={act}
          onAdd={addProjects}
          onOpen={(project) => {
            setOpenId(project.id);
            act(() => api.touch(project.id));
          }}
        />
      )}
    </main>
  );
}
