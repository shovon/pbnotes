import { useMemo, useState } from 'react';
import type { Availability, Project } from '../shared/projects';
import { AVAILABILITY_LABEL, formatLastOpened } from './ui';
import type { Act } from './ui';

const { projects: api } = window.gnotes;

type Props = {
  projects: Project[];
  availability: Record<string, Availability>;
  loading: boolean;
  act: Act;
  onAdd: () => void;
  onOpen: (project: Project) => void;
};

export default function ProjectsList({
  projects,
  availability,
  loading,
  act,
  onAdd,
  onOpen,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      total: projects.length,
      unavailable: Object.values(availability).filter((a) => a !== 'available')
        .length,
    }),
    [projects, availability],
  );

  return (
    <>
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
        <button className="primary" onClick={onAdd}>
          Add Project…
        </button>
      </header>

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
                onClick={() => act(() => api.setPinned(project.id, !project.pinned))}
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
                      act(() => api.rename(project.id, name));
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
                <button onClick={() => onOpen(project)}>Open</button>
                <button
                  onClick={() =>
                    act(async () => {
                      await api.touch(project.id);
                      await api.reveal(project.id);
                    })
                  }
                >
                  Reveal
                </button>
                <button onClick={() => act(() => api.relocate(project.id))}>
                  Locate…
                </button>
                <button
                  className="danger"
                  onClick={() => act(() => api.remove(project.id))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
