import { app } from 'electron';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Ordered schema migrations. Append only, never edit an entry that has
 * shipped; `PRAGMA user_version` records how many have been applied.
 */
const MIGRATIONS: string[] = [
  // The registry of directories the user asked us to track. Load-bearing, not
  // scaffolding: the filesystem has no way to record that a user pointed this
  // app at a directory, so this table is the only thing that remembers. See
  // README.md before removing it.
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

  // This machine's identity in a shared folder, and what it remembers between
  // sessions about the log in each project.
  //
  // The id is here rather than in the project folder precisely because the
  // project folder is the thing that gets copied: restore a backup or clone a
  // VM and anything inside it comes along, including the claim to a log path.
  // `userData` does not travel, which is the property the id needs. Losing
  // this table costs a machine its identity and nothing else — it mints a new
  // one, writes in a new directory, and still reads every log already there.
  `CREATE TABLE device (
     only_row INTEGER PRIMARY KEY CHECK (only_row = 1),
     id       TEXT NOT NULL
   );
   CREATE TABLE log_state (
     project_id  TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
     -- Highest hybrid logical clock observed, so a folder that loses files to
     -- selective sync cannot walk our clock backwards.
     clock_l     INTEGER NOT NULL,
     clock_c     INTEGER NOT NULL,
     -- The last record we appended. A log running past it has another writer.
     tip_segment INTEGER,
     tip_seq     INTEGER
   );`,
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
