/**
 * This machine's identity, and what it remembers about each project's log.
 *
 * All of it lives in `notes.db` — under `userData`, never in the project
 * folder. That is the whole point: the shared folder is what gets copied to a
 * second machine, so anything stored inside it would be copied along with the
 * right to write in a directory only one device may write in.
 *
 * Losing this file costs the machine its identity and nothing else. It mints a
 * new id, starts a new directory, and goes on reading every log already in the
 * folder — which is the same promise `README.md` makes about the registry.
 */
import { randomUUID } from 'node:crypto';
import { getDatabase } from './db';
import type { DeviceMemory } from './event-log';

/** Mints one on first call and keeps it thereafter. */
export function deviceId(): string {
  const db = getDatabase();
  const row = db.prepare('SELECT id FROM device WHERE only_row = 1').get() as
    | { id: string }
    | undefined;
  if (row) return row.id;

  const id = randomUUID();
  db.prepare('INSERT INTO device (only_row, id) VALUES (1, ?)').run(id);
  return id;
}

/**
 * Replaces this machine's identity. Called when another machine turns out to
 * be writing in our directory — a restored backup, a copied VM — where moving
 * is free and losing events is not.
 *
 * Every project's remembered tip goes with it: the new id has never written
 * anywhere, so there is no tip to compare against.
 */
export function rotateDeviceId(): string {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare('UPDATE device SET id = ? WHERE only_row = 1').run(id);
  db.prepare('UPDATE log_state SET tip_segment = NULL, tip_seq = NULL').run();
  return id;
}

export function recall(projectId: string): DeviceMemory {
  const row = getDatabase()
    .prepare(
      `SELECT clock_l, clock_c, tip_segment, tip_seq
         FROM log_state WHERE project_id = ?`,
    )
    .get(projectId) as
    | {
        clock_l: number;
        clock_c: number;
        tip_segment: number | null;
        tip_seq: number | null;
      }
    | undefined;

  if (!row) return { clock: { l: 0, c: 0 }, tip: null };
  return {
    clock: { l: row.clock_l, c: row.clock_c },
    tip:
      row.tip_segment === null || row.tip_seq === null
        ? null
        : { segment: row.tip_segment, seq: row.tip_seq },
  };
}

export function remember(projectId: string, memory: DeviceMemory): void {
  getDatabase()
    .prepare(
      `INSERT INTO log_state
         (project_id, clock_l, clock_c, tip_segment, tip_seq)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET
         clock_l     = excluded.clock_l,
         clock_c     = excluded.clock_c,
         tip_segment = excluded.tip_segment,
         tip_seq     = excluded.tip_seq`,
    )
    .run(
      projectId,
      memory.clock.l,
      memory.clock.c,
      memory.tip?.segment ?? null,
      memory.tip?.seq ?? null,
    );
}
