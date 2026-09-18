import { app } from 'electron';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Ordered schema migrations. Append only, never edit an entry that has
 * shipped; `PRAGMA user_version` records how many have been applied.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
     id             TEXT PRIMARY KEY,
     path           TEXT NOT NULL,
     -- Canonical form of the path, used only for uniqueness. Stored rather
     -- than computed so the UNIQUE index can do the work.
     path_key       TEXT NOT NULL UNIQUE,
     name           TEXT NOT NULL,
     added_at       TEXT NOT NULL,
     last_opened_at TEXT,
     pinned         INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX idx_projects_last_opened ON projects (last_opened_at DESC);`,
];

let db: DatabaseSync | null = null;

export function openDatabase(): DatabaseSync {
  if (db) return db;

  const file = path.join(app.getPath('userData'), 'notes.db');
  db = new DatabaseSync(file);

  // WAL keeps reads from blocking writes and survives a hard kill far better
  // than the default rollback journal.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  migrate(db);
  return db;
}

export function getDatabase(): DatabaseSync {
  if (!db) throw new Error('Database accessed before openDatabase()');
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}

function migrate(database: DatabaseSync): void {
  const row = database.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  const applied = row.user_version;

  for (let version = applied; version < MIGRATIONS.length; version++) {
    database.exec('BEGIN');
    try {
      database.exec(MIGRATIONS[version]);
      // PRAGMA does not accept bound parameters, hence the interpolation. The
      // value is a loop index, never user input.
      database.exec(`PRAGMA user_version = ${version + 1}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
