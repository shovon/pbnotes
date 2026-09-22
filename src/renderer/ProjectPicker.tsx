import type { Project } from '../shared/projects';

/**
 * The option that opens the directory picker instead of switching project.
 * A value no id can collide with — ids are uuids.
 */
const ADD = 'add';

type Props = {
  projects: Project[];
  projectId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
};

/**
 * Which project is open, as a plain `<select>`: one click to the list, one to
 * switch. Native means the platform's own menu, keyboard behaviour and
 * type-ahead for free, and it stays right for forty projects as well as for
 * two.
 */
export default function ProjectPicker({
  projects,
  projectId,
  onSelect,
  onAdd,
}: Props) {
  return (
    <select
      className="picker"
      aria-label="Project"
      /* Controlled, so picking "Open project…" snaps back to the open
         project while the directory dialog decides what happens next. */
      value={projectId}
      onChange={(event) =>
        event.target.value === ADD ? onAdd() : onSelect(event.target.value)
      }
    >
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
      <option value={ADD}>Open project…</option>
    </select>
  );
}
