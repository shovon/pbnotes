import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AddOutcome,
  Availability,
  Project,
} from '../../../shared/projects';

type ProjectRow = {
  id: string;
  path: string;
  path_key: string;
  name: string;
  added_at: string;
  last_opened_at: string | null;
  pinned: number;
};

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    pinned: row.pinned === 1,
  };
}

/**
 * The key that decides whether two paths are one directory, by the platform's
 * usual filesystem. macOS and Windows are case-insensitive by default, so
 * `/Users/Shovon/x` and `/Users/shovon/x` are the same directory and must not
 * both end up in the list. (An APFS volume *can* be case-sensitive; folding
 * anyway costs us nothing beyond refusing a duplicate that differs only by
 * case, which is the friendlier failure.)
 */
export function pathKeyOn(platform: string): (canonical: string) => string {
  return platform === 'linux'
    ? (canonical) => canonical
    : (canonical) => canonical.toLowerCase();
}

/** What the registry asks of the disk, and nothing else of it. */
export type Disk = {
  /** The path with `.`/`..` and symlinks resolved. Rejects for one that cannot be read. */
  canonicalize(input: string): Promise<string>;
  /** Rejects for a path that cannot be read. */
  isDirectory(path: string): Promise<boolean>;
  /** Whether a tracked directory can be reached now. Never rejects. */
  probe(path: string): Promise<Availability>;
};

/**
 * Everything the registry reads from outside besides `db`: the disk, the
 * clock that dates an add or an open, where a new project's id comes from,
 * and the key that makes two paths one directory (`pathKeyOn`).
 */
export type ProjectsStoreDeps = {
  disk: Disk;
  now: () => Date;
  newId: () => string;
  pathKey: (canonical: string) => string;
};

/**
 * The registry of tracked projects, over `db`. Every query goes through the
 * handle passed in, and every read of the disk, the clock or randomness
 * through `deps`; nothing here holds one of its own.
 */
export function createProjectsStore(
  db: DatabaseSync,
  { disk, now, newId, pathKey: toPathKey }: ProjectsStoreDeps,
) {
  function listProjects(): Project[] {
    const rows = db
      .prepare(
        `SELECT * FROM projects
         ORDER BY pinned DESC,
                  last_opened_at IS NULL,
                  last_opened_at DESC,
                  name COLLATE NOCASE`,
      )
      .all() as unknown as ProjectRow[];
    return rows.map(toProject);
  }

  function getProject(id: string): Project | null {
    const row = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as unknown as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  function findByPathKey(pathKey: string): Project | null {
    const row = db
      .prepare('SELECT * FROM projects WHERE path_key = ?')
      .get(pathKey) as unknown as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  async function addProject(input: string): Promise<AddOutcome> {
    let canonical: string;
    try {
      canonical = await disk.canonicalize(input);
      if (!(await disk.isDirectory(canonical))) {
        return { status: 'failed', path: input, reason: 'not-a-directory' };
      }
    } catch {
      return { status: 'failed', path: input, reason: 'unreadable' };
    }

    const pathKey = toPathKey(canonical);
    const existing = findByPathKey(pathKey);
    if (existing) return { status: 'already-tracked', project: existing };

    const project: Project = {
      id: newId(),
      path: canonical,
      name: path.basename(canonical),
      addedAt: now().toISOString(),
      lastOpenedAt: null,
      pinned: false,
    };

    db
      .prepare(
        `INSERT INTO projects (id, path, path_key, name, added_at, last_opened_at, pinned)
         VALUES (?, ?, ?, ?, ?, NULL, 0)`,
      )
      .run(project.id, project.path, pathKey, project.name, project.addedAt);

    return { status: 'added', project };
  }

  async function addProjects(inputs: string[]): Promise<AddOutcome[]> {
    const outcomes: AddOutcome[] = [];
    for (const input of inputs) outcomes.push(await addProject(input));
    return outcomes;
  }

  function removeProject(id: string): void {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  function renameProject(id: string, name: string): Project | null {
    const trimmed = name.trim();
    // An empty label would render as a blank row with no way to fix it, so fall
    // back to the directory name rather than storing it.
    const project = getProject(id);
    if (!project) return null;
    const next = trimmed === '' ? path.basename(project.path) : trimmed;

    db
      .prepare('UPDATE projects SET name = ? WHERE id = ?')
      .run(next, id);
    return getProject(id);
  }

  function setPinned(id: string, pinned: boolean): Project | null {
    db
      .prepare('UPDATE projects SET pinned = ? WHERE id = ?')
      .run(pinned ? 1 : 0, id);
    return getProject(id);
  }

  function touchProject(id: string): Project | null {
    db
      .prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?')
      .run(now().toISOString(), id);
    return getProject(id);
  }

  /**
   * Repoints a tracked project at a new directory, keeping its id so anything
   * attached to the project survives the move.
   */
  async function relocateProject(
    id: string,
    newPath: string,
  ): Promise<Project | null> {
    const project = getProject(id);
    if (!project) return null;

    const canonical = await disk.canonicalize(newPath);
    const pathKey = toPathKey(canonical);

    const collision = findByPathKey(pathKey);
    if (collision && collision.id !== id) {
      throw new Error(
        `That directory is already tracked as "${collision.name}".`,
      );
    }

    db
      .prepare('UPDATE projects SET path = ?, path_key = ? WHERE id = ?')
      .run(canonical, pathKey, id);
    return getProject(id);
  }

  async function checkAvailability(
    ids: string[],
  ): Promise<Record<string, Availability>> {
    const projects = ids
      .map((id) => getProject(id))
      .filter((project): project is Project => project !== null);

    const results = await Promise.all(
      projects.map(async (project) => [
        project.id,
        await disk.probe(project.path),
      ] as const),
    );

    return Object.fromEntries(results);
  }

  return {
    listProjects,
    getProject,
    addProject,
    addProjects,
    removeProject,
    renameProject,
    setPinned,
    touchProject,
    relocateProject,
    checkAvailability,
  };
}

export type ProjectsStore = ReturnType<typeof createProjectsStore>;
