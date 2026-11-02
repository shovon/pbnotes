/**
 * `bench.db`: where the bench's slots are kept on this machine. Its schema is
 * the bench's own, not `notes.db`'s, and losing the file costs only
 * conveniences (DNA.md, "The bench").
 */
import type { DatabaseSync } from "node:sqlite";
import { openMigrated } from "../../sqlite.ts";
import type { SlotStore } from "./bench.ts";

const MIGRATIONS = [
  // One row per project and slot. `project_id` is the registry's UUID, with
  // no foreign key: the registry is another file, and rows for a project that
  // has been removed are harmless. `value` is JSON, decoded by the slot.
  `CREATE TABLE slots (
     project_id TEXT NOT NULL,
     slot       TEXT NOT NULL,
     value      TEXT NOT NULL,
     PRIMARY KEY (project_id, slot)
   );`,
];

/** Opens and migrates `bench.db` at `file`; `':memory:'` for a test. */
export function openBenchDatabase(file: string): DatabaseSync {
  return openMigrated(file, MIGRATIONS);
}

/** The slots table over `db`, which the caller owns. */
export function createSlotStore(db: DatabaseSync): SlotStore {
  const select = db.prepare(
    "SELECT value FROM slots WHERE project_id = ? AND slot = ?",
  );
  const upsert = db.prepare(
    `INSERT INTO slots (project_id, slot, value) VALUES (?, ?, ?)
       ON CONFLICT (project_id, slot) DO UPDATE SET value = excluded.value`,
  );
  return {
    read: (projectId, slot) =>
      (select.get(projectId, slot) as { value: string } | undefined)?.value,
    write: (projectId, slot, json) => {
      upsert.run(projectId, slot, json);
    },
  };
}
