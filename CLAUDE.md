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
- The renderer reaches main only through `window.gnotes`; keep new surface
  behind the context bridge in `src/preload/index.ts`.
