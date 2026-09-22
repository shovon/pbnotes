import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Availability, Project } from '../shared/projects';

const { projects: api } = window.gnotes;

const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: '',
  missing: 'Not found',
  unknown: 'Unreachable',
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

function formatLastOpened(iso: string | null): string {
  if (!iso) return 'Never opened';
  const opened = new Date(iso);
  const days = Math.floor((Date.now() - opened.getTime()) / 86_400_000);
  if (days === 0) return 'Opened today';
  if (days === 1) return 'Opened yesterday';
  if (days < 30) return `Opened ${days} days ago`;
  return `Opened ${opened.toLocaleDateString()}`;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [availability, setAvailability] = useState<Record<string, Availability>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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
   * Every button here reaches main, and every one of those calls can reject —
   * relocating onto an already-tracked directory does exactly that. Unhandled,
   * the rejection is silent and the click looks like a no-op, so they all route
   * through here and surface the reason.
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
  const addProjects = useCallback(
    () =>
      run(async () => {
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

  const counts = useMemo(
    () => ({
      total: projects.length,
      unavailable: Object.values(availability).filter((a) => a !== 'available')
        .length,
    }),
    [projects, availability],
  );

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>Projects</h1>
          <p className="subtitle">
            {loading
              ? 'Loading…'
              : counts.total === 0
                ? 'No projects tracked yet'
                : `${counts.total} tracked` +
                  (counts.unavailable > 0
                    ? ` · ${counts.unavailable} unavailable`
                    : '')}
          </p>
        </div>
        <button className="primary" onClick={() => void addProjects()}>
          Add Project…
        </button>
      </header>

      {notice && (
        <p className="notice" onClick={() => setNotice(null)}>
          {notice}
        </p>
      )}

      {!loading && projects.length === 0 ? (
        <p className="empty">
          Track a project directory to keep it a click away. Nothing is copied —
          gnotes only remembers where it lives.
        </p>
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li
              key={project.id}
              className={`project ${availability[project.id] ?? 'available'}`}
            >
              <button
                className="pin"
                title={project.pinned ? 'Unpin' : 'Pin to top'}
                aria-pressed={project.pinned}
                onClick={() =>
                  void run(async () => {
                    await api.setPinned(project.id, !project.pinned);
                    await refresh();
                  })
                }
              >
                {project.pinned ? '★' : '☆'}
              </button>

              <div className="project-body">
                {editingId === project.id ? (
                  <input
                    className="rename"
                    autoFocus
                    defaultValue={project.name}
                    onBlur={(event) => {
                      const name = event.target.value;
                      setEditingId(null);
                      void run(async () => {
                        await api.rename(project.id, name);
                        await refresh();
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    className="name"
                    title="Rename"
                    onClick={() => setEditingId(project.id)}
                  >
                    {project.name}
                  </button>
                )}

                <div className="meta">
                  <span className="path" title={project.path}>
                    {project.path}
                  </span>
                  <span className="dot">·</span>
                  <span>{formatLastOpened(project.lastOpenedAt)}</span>
                  {availability[project.id] &&
                    availability[project.id] !== 'available' && (
                      <span className="badge">
                        {AVAILABILITY_LABEL[availability[project.id]]}
                      </span>
                    )}
                </div>
              </div>

              <div className="actions">
                <button
                  onClick={() =>
                    void run(async () => {
                      await api.touch(project.id);
                      await api.reveal(project.id);
                      await refresh();
                    })
                  }
                >
                  Reveal
                </button>
                <button
                  onClick={() =>
                    void run(async () => {
                      await api.relocate(project.id);
                      await refresh();
                    })
                  }
                >
                  Locate…
                </button>
                <button
                  className="danger"
                  onClick={() =>
                    void run(async () => {
                      await api.remove(project.id);
                      await refresh();
                    })
                  }
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
