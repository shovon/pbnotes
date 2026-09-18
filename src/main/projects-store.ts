import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDatabase } from './db';
import type {
  AddOutcome,
  Availability,
  Project,
} from '../shared/projects';

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
 * macOS and Windows filesystems are case-insensitive by default, so
 * `/Users/Shovon/x` and `/Users/shovon/x` are the same directory and must not
 * both end up in the list. (An APFS volume *can* be case-sensitive; folding
 * anyway costs us nothing beyond refusing a duplicate that differs only by
 * case, which is the friendlier failure.)
 */
function toPathKey(absolutePath: string): string {
  return process.platform === 'linux'
    ? absolutePath
    : absolutePath.toLowerCase();
}

/** Resolves `.`/`..` and symlinks so the same directory always keys the same. */
async function canonicalize(input: string): Promise<string> {
  return fs.realpath(path.resolve(input));
}

export function listProjects(): Project[] {
  const rows = getDatabase()
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

export function getProject(id: string): Project | null {
  const row = getDatabase()
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(id) as unknown as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

function findByPathKey(pathKey: string): Project | null {
  const row = getDatabase()
    .prepare('SELECT * FROM projects WHERE path_key = ?')
    .get(pathKey) as unknown as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export async function addProject(input: string): Promise<AddOutcome> {
  let canonical: string;
  try {
    canonical = await canonicalize(input);
    const stats = await fs.stat(canonical);
    if (!stats.isDirectory()) {
      return { status: 'failed', path: input, reason: 'not-a-directory' };
    }
  } catch {
    return { status: 'failed', path: input, reason: 'unreadable' };
  }

  const pathKey = toPathKey(canonical);
  const existing = findByPathKey(pathKey);
  if (existing) return { status: 'already-tracked', project: existing };

  const project: Project = {
    id: randomUUID(),
    path: canonical,
    name: path.basename(canonical),
    addedAt: new Date().toISOString(),
    lastOpenedAt: null,
    pinned: false,
  };

  getDatabase()
    .prepare(
      `INSERT INTO projects (id, path, path_key, name, added_at, last_opened_at, pinned)
       VALUES (?, ?, ?, ?, ?, NULL, 0)`,
    )
    .run(project.id, project.path, pathKey, project.name, project.addedAt);

  return { status: 'added', project };
}

export async function addProjects(inputs: string[]): Promise<AddOutcome[]> {
  const outcomes: AddOutcome[] = [];
  for (const input of inputs) outcomes.push(await addProject(input));
  return outcomes;
}

export function removeProject(id: string): void {
  getDatabase().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function renameProject(id: string, name: string): Project | null {
  const trimmed = name.trim();
  // An empty label would render as a blank row with no way to fix it, so fall
  // back to the directory name rather than storing it.
  const project = getProject(id);
  if (!project) return null;
  const next = trimmed === '' ? path.basename(project.path) : trimmed;

  getDatabase()
    .prepare('UPDATE projects SET name = ? WHERE id = ?')
    .run(next, id);
  return getProject(id);
}

export function setPinned(id: string, pinned: boolean): Project | null {
  getDatabase()
    .prepare('UPDATE projects SET pinned = ? WHERE id = ?')
    .run(pinned ? 1 : 0, id);
  return getProject(id);
}

export function touchProject(id: string): Project | null {
  getDatabase()
    .prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
  return getProject(id);
}

/**
 * Repoints a tracked project at a new directory, keeping its id so anything
 * attached to the project survives the move.
 */
export async function relocateProject(
  id: string,
  newPath: string,
): Promise<Project | null> {
  const project = getProject(id);
  if (!project) return null;

  const canonical = await canonicalize(newPath);
  const pathKey = toPathKey(canonical);

  const collision = findByPathKey(pathKey);
  if (collision && collision.id !== id) {
    throw new Error(
      `That directory is already tracked as "${collision.name}".`,
    );
  }

  getDatabase()
    .prepare('UPDATE projects SET path = ?, path_key = ? WHERE id = ?')
    .run(canonical, pathKey, id);
  return getProject(id);
}

/**
 * A `stat` against an unreachable network share can block for a long time, so
 * a slow probe reports `unknown` instead of stalling the list or being
 * mistaken for a deletion.
 */
const AVAILABILITY_TIMEOUT_MS = 2_000;

async function probe(directory: string): Promise<Availability> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Availability>((resolve) => {
    timer = setTimeout(() => resolve('unknown'), AVAILABILITY_TIMEOUT_MS);
  });
  const stat = fs.stat(directory).then(
    (stats): Availability => (stats.isDirectory() ? 'available' : 'missing'),
    (): Availability => 'missing',
  );

  try {
    return await Promise.race([stat, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAvailability(
  ids: string[],
): Promise<Record<string, Availability>> {
  const projects = ids
    .map((id) => getProject(id))
    .filter((project): project is Project => project !== null);

  const results = await Promise.all(
    projects.map(async (project) => [
      project.id,
      await probe(project.path),
    ] as const),
  );

  return Object.fromEntries(results);
}
