# gnotes

Electron + React + TypeScript, built with Electron Forge and Vite.

## Before removing anything

The `projects` table and the `projects:*` IPC surface are **not** dead code, however little UI currently sits on top of them. They are the only record of which directories the user asked gnotes to track; the filesystem cannot hold that choice, so deleting them loses it permanently. See the "Why the `projects` table exists" section of `README.md` before touching `src/main/projects-*.ts`, `src/shared/projects.ts`, or the `projects` migration in `src/main/db.ts`.

## Storage boundary

Two stores, and they do not swap. SQLite holds the projects registry and config; the append-only event log in `src/main/event-log.ts` holds project content. Content is never moved into SQLite and the registry is never moved onto the log — see "Two stores, on purpose" in `README.md`.

**Content is written inside the user's project directory** (`<project>/gnotes/`, a plain folder, not behind a dot), never under `userData`. The folder is the point: notes back up, sync and move with the work they describe, and losing the app's support directory must never lose a word the user wrote. `userData` holds `notes.db` and nothing else that matters.

## Conventions

- For Markdown prose, use one line per paragraph, rather than hard-wrap. Most developers viewing Mardown files are already viewing them in editors that support soft-wrap. And also, single-paragraph diffs look much nicer if we are not beholden to the 80 character limit
- Migrations in `src/main/db.ts` are append-only. Add an entry, never edit a shipped one; `PRAGMA user_version` counts what has been applied.
- `src/shared` is bundled into the renderer as well as main — types and constants only, no `node:` imports.
- Events are folded into the view in main only (`src/main/projection.ts`). Do not replay or fold in the renderer. Reducers stay pure, over structured-cloneable state, so the fold can move to a worker later.
- Log events are immutable. A payload shape that changes gets a new `v` and is upcast when read; the file on disk is never rewritten or compacted.
- The log is segmented per device: `gnotes/<device-id>/0000000000000001.log` upward, sixteen digits so text order matches numeric order. Only the newest segment is written to, and `seq` keeps counting across them _within that device_. Sealed at 16 MiB or at local midnight, whichever comes first.
- **One writer per file, forever.** A device appends only inside its own directory; nothing is written at the top of `gnotes/`. This is what makes the folder safe in Dropbox, and it is not negotiable — two machines on one path is how the folder loses notes silently.
- `seq` detects damage within a device. Ordering across devices is the hybrid logical clock (`hlc`), floored by what has been seen and bounded against a clock set to the wrong year. Never order by `at`; it is for display.
- Never truncate, rewrite or repair a file belonging to another device. A half-arrived foreign log stalls and retries; it must never stop a project from opening. See `docs/multi-writer.md`.
- The renderer reaches main only through `window.gnotes`; keep new surface behind the context bridge in `src/preload/index.ts`.
- Each component should have an associated story in Storybook.
- Encapsulate by folder
  - Storybook stories and components should remain in the same folder
    - Component B used by component A, and by no one else: safe to place component B's folder inside component A's.
- For views and front-end-only business logic: use the vertical slice architecture
