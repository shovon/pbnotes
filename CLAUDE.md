# gnotes

Electron + React + TypeScript, built with Electron Forge and Vite.

## Before removing anything

The `projects` table and the `projects:*` IPC surface are **not** dead code,
however little UI currently sits on top of them. They are the only record of
which directories the user asked gnotes to track; the filesystem cannot hold
that choice, so deleting them loses it permanently. See the "Why the `projects`
table exists" section of `README.md` before touching `src/main/projects-*.ts`,
`src/shared/projects.ts`, or the `projects` migration in `src/main/db.ts`.

## Storage boundary

Two stores, and they do not swap. SQLite holds the projects registry and
config; the append-only event log in `src/main/event-log.ts` holds project
content. Content is never moved into SQLite and the registry is never moved
onto the log — see "Two stores, on purpose" in `README.md`.

**Content is written inside the user's project directory**
(`<project>/gnotes/`, a plain folder, not behind a dot), never under
`userData`. The folder is the
point: notes back up, sync and move with the work they describe, and losing
the app's support directory must never lose a word the user wrote. `userData`
holds `notes.db` and nothing else that matters.

## Conventions

- Migrations in `src/main/db.ts` are append-only. Add an entry, never edit a
  shipped one; `PRAGMA user_version` counts what has been applied.
- `src/shared` is bundled into the renderer as well as main — types and
  constants only, no `node:` imports.
- Events are folded into the view in main only (`src/main/projection.ts`).
  Do not replay or fold in the renderer. Reducers stay pure, over
  structured-cloneable state, so the fold can move to a worker later.
- Log events are immutable. A payload shape that changes gets a new `v` and is
  upcast when read; the file on disk is never rewritten or compacted.
- The log is segmented: `gnotes/0000000000000001.log` upward, sixteen digits so
  text order matches numeric order. Only the newest segment is written to, and
  `seq` keeps counting across them. Sealed at 16 MiB or at local midnight,
  whichever comes first.
- The renderer reaches main only through `window.gnotes`; keep new surface
  behind the context bridge in `src/preload/index.ts`.
