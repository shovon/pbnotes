/**
 * The bench's files: one SQLite file per project, `<dir>/<project-id>.db`.
 * Its schema is the bench's own, not `notes.db`'s, and losing a file costs
 * only that project's conveniences (DNA.md, "The bench").
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openMigrated } from "../../sqlite.ts";
import type { OpenStore, SlotStore } from "./bench.ts";

const MIGRATIONS = [
  // One row per slot. The file is one project's, so nothing in it names a
  // project. `value` is JSON, decoded by the slot.
  `CREATE TABLE slots (
     slot  TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
];

/** Opens and migrates one bench file at `file`; `':memory:'` for a test. */
export function openBenchDatabase(file: string): DatabaseSync {
  return openMigrated(file, MIGRATIONS);
}

/** The slots table over `db`, which the caller owns. */
export function createSlotStore(db: DatabaseSync): SlotStore {
  const select = db.prepare("SELECT value FROM slots WHERE slot = ?");
  const upsert = db.prepare(
    `INSERT INTO slots (slot, value) VALUES (?, ?)
       ON CONFLICT (slot) DO UPDATE SET value = excluded.value`,
  );
  return {
    read: (slot) => (select.get(slot) as { value: string } | undefined)?.value,
    write: (slot, json) => {
      upsert.run(slot, json);
    },
  };
}

/** The registry's ids are UUIDs, and only one of those becomes a file name. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each project's bench file in `dir`. Without `create`, a project with no
 * file gets none: nothing is made on disk until something is kept.
 */
export function benchFiles(dir: string): OpenStore {
  return (projectId, create) => {
    if (!PROJECT_ID.test(projectId)) {
      throw new Error(`Not a project id: "${projectId}"`);
    }
    const file = path.join(dir, `${projectId}.db`);
    if (!create && !existsSync(file)) return undefined;
    mkdirSync(dir, { recursive: true });
    const db = openBenchDatabase(file);
    return { ...createSlotStore(db), close: () => db.close() };
  };
}
