/**
 * Opening a SQLite file that carries its own schema history. Knows nothing
 * about what any table is for: `notes.db` and `bench.db` each hand in their
 * own list.
 */
import { DatabaseSync } from "node:sqlite";

/**
 * Ordered schema migrations. Append only, never edit an entry that has
 * shipped; `PRAGMA user_version` records how many have been applied.
 */
export type Migrations = readonly string[];

/**
 * Opens `file` and brings it up to `migrations`. No handle is kept here: the
 * caller owns what this returns, hands it to whatever needs it, and closes it.
 * `':memory:'` gives a test a fresh, migrated database.
 *
 * If it throws, the file is closed first: the caller never got a handle to
 * close, and Windows will not delete a file that is still open.
 */
export function openMigrated(file: string, migrations: Migrations): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    // WAL keeps reads from blocking writes and survives a hard kill far
    // better than the default rollback journal.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    migrate(db, migrations);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function migrate(database: DatabaseSync, migrations: Migrations): void {
  const row = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };

  for (let version = row.user_version; version < migrations.length; version++) {
    database.exec("BEGIN");
    try {
      database.exec(migrations[version]);
      // PRAGMA does not accept bound parameters, hence the interpolation. The
      // value is a loop index, never user input.
      database.exec(`PRAGMA user_version = ${version + 1}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
