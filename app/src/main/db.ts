import { DatabaseSync } from 'node:sqlite';

/**
 * Ordered schema migrations. Append only, never edit an entry that has
 * shipped; `PRAGMA user_version` records how many have been applied.
 */
const MIGRATIONS: string[] = [
  // The registry of directories the user asked us to track. Load-bearing, not
  // scaffolding: the filesystem has no way to record that a user pointed this
  // app at a directory, so this table is the only thing that remembers. See
  // docs/design.md before removing it.
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

  // Where the main window was when it was last closed. Pure convenience: the
  // only cost of losing this row is a default-sized window, which is why it
  // sits here rather than anywhere it would have to be kept in step.
  `CREATE TABLE window_state (
     only_row  INTEGER PRIMARY KEY CHECK (only_row = 1),
     x         INTEGER NOT NULL,
     y         INTEGER NOT NULL,
     width     INTEGER NOT NULL,
     height    INTEGER NOT NULL,
     maximized INTEGER NOT NULL DEFAULT 0
   );`,

  // Which projects still keep their ledger in `<project>/gnotes/` (#42): every
  // one tracked when this runs, and none added after. `pending` until the
  // move starts, `moving` once it has, NULL once `LEDGER` is at the top. The
  // folder cannot say this itself: a project added later is in the same table.
  `ALTER TABLE projects ADD COLUMN ledger_move TEXT;
   UPDATE projects SET ledger_move = 'pending';`,

  // That move has run on every machine there is (#43), and its code is gone.
  `ALTER TABLE projects DROP COLUMN ledger_move;`,

  // Every session writes in a directory of its own (#50), so there is no
  // identity to keep and no tip to remember.
  `DROP TABLE log_state;
   DROP TABLE device;`,
];

/**
 * Opens and migrates the database at `file`. No handle is kept here: the
 * caller owns what this returns, hands it to whatever needs it, and closes it.
 * `':memory:'` gives a test a fresh, migrated database.
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);

  // WAL keeps reads from blocking writes and survives a hard kill far better
  // than the default rollback journal.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  migrate(db);
  return db;
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
