import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Availability, Project } from '../shared/projects';

const { projects: api } = window.gnotes;

const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: '',
  missing: 'Not found',
  unknown: 'Unreachable',
};

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
   */
  const refresh = useCallback(async () => {
    const next = await api.list();
    setProjects(next);
    setLoading(false);
    if (next.length > 0) {
      setAvailability(await api.availability(next.map((p) => p.id)));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addProjects = useCallback(async () => {
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
    setNotice(parts.length > 0 ? parts.join(' · ') : null);

    await refresh();
  }, [refresh]);

  const update = useCallback((project: Project | null) => {
    if (!project) return;
    setProjects((current) =>
      current.map((item) => (item.id === project.id ? project : item)),
    );
  }, []);

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
                onClick={async () => {
                  await api.setPinned(project.id, !project.pinned);
                  await refresh();
                }}
              >
                {project.pinned ? '★' : '☆'}
              </button>

              <div className="project-body">
                {editingId === project.id ? (
                  <input
                    className="rename"
                    autoFocus
                    defaultValue={project.name}
                    onBlur={async (event) => {
                      update(await api.rename(project.id, event.target.value));
                      setEditingId(null);
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
                  onClick={async () => {
                    update(await api.touch(project.id));
                    await api.reveal(project.id);
                  }}
                >
                  Reveal
                </button>
                <button
                  onClick={async () => {
                    update(await api.relocate(project.id));
                    await refresh();
                  }}
                >
                  Locate…
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    await api.remove(project.id);
                    await refresh();
                  }}
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
