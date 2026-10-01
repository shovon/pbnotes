# pbnotes

Electron + React + TypeScript, built with Electron Forge and Vite.

## Naming

The app is called **pbnotes**. The one place `gnotes` is the correct name is the content folder inside a user's project, `<project>/gnotes/`: it is on-disk format, and it stays. Name everything else `pbnotes`.

## Before removing anything

The `projects` table and the `projects:*` IPC surface are **not** dead code, however little UI currently sits on top of them. They are the only record of which directories the user asked pbnotes to track; the filesystem cannot hold that choice, so deleting them loses it permanently. See the "Why the `projects` table exists" section of `../README.md` before touching `src/main/features/projects/projects-*.ts`, `src/shared/projects.ts`, or the `projects` migration in `src/main/db.ts`.

## Storage boundary

Two stores, and they do not swap. SQLite holds the projects registry and config; the append-only event log in `src/main/ledger/event-log/event-log.ts` holds project content. Content is never moved into SQLite and the registry is never moved onto the log — see "Two stores, on purpose" in `../README.md`.

**Content is written inside the user's project directory** (`<project>/gnotes/`, a plain folder, not behind a dot), never under `userData`. The folder is the point: notes back up, sync and move with the work they describe, and losing the app's support directory must never lose a word the user wrote. `userData` holds `notes.db` and nothing else that matters.

## Conventions

- For Markdown prose, use one line per paragraph, rather than hard-wrap. Most developers viewing Mardown files are already viewing them in editors that support soft-wrap. And also, single-paragraph diffs look much nicer if we are not beholden to the 80 character limit
- Migrations in `src/main/db.ts` are append-only. Add an entry, never edit a shipped one; `PRAGMA user_version` counts what has been applied.
- `src/shared` is bundled into the renderer as well as main — types and constants only, no `node:` imports.
- Main has three parts. `src/main/ledger/` is plumbing and knows no event's meaning. `src/main/features/<name>/` holds one subject each (`projects`, `window-state`). The shell (`db.ts`, `ipc.ts`, `index.ts`) is not a feature and stays loose in `src/main/`.
- The project is the top primitive, so `features/projects/` holds the registry (`projects-store.ts`, `projects-ipc.ts`) and everything a project contains nests under it (`pages/`, and blocks inside that). A sub-feature takes its project from `requireProject` in `projects-ipc.ts` before it opens a ledger — that is the check that stops a write to an unmounted drive. `projects-ipc.ts` hears the ledger's `onArrival` and calls `pagesArrived` in `pages-ipc.ts`; `onArrival` holds one listener, so a second caller replaces the first.
- Events are folded into the view in main only (`src/main/ledger/projection/projection.ts`). Do not replay or fold in the renderer. Reducers stay pure, over structured-cloneable state, so the fold can move to a worker later.
- A project has one ledger, and a feature reads and writes it through a fold of its own: `defineFold(name, { reduce, initial, handles })` in `src/main/ledger/project-ledger/project-ledger.ts`, called once at module load. Never open a `Projection` or an `EventLog` on a project's folder directly — a second appender is a second writer in this device's directory. Folds must be defined before any project opens, so a feature is imported statically from `index.ts`, never lazily.
- Every fold is handed every event. A reducer returns the same `state` object for an event that is not its own, and never throws: one fold throwing fails the open for the whole project. Event type names are shared across features, so prefix them (`block.*`).
- One IPC channel, one feature, one `ipcMain.handle` handler. Fan-out happens in the ledger, not on the channel: a feature that cares about another feature's write folds that event in its own reducer, which also covers events arriving from other devices. Never attach a second handler or sub-handler to a channel, and never move to `ipcMain.on` to get one — a reply has one owner, and a write that half-succeeds across two handlers reaches the renderer as one rejection. Anything that is not a ledger event (a second read, a side effect outside the log) is a second channel the renderer calls separately.
- Log events are immutable. A payload shape that changes gets a new `v` and is upcast when read; the file on disk is never rewritten or compacted.
- The log is segmented per device: `gnotes/<device-id>/0000000000000001.log` upward, sixteen digits so text order matches numeric order. Only the newest segment is written to, and `seq` keeps counting across them _within that device_. Sealed at 16 MiB or at local midnight, whichever comes first.
- **One writer per file, forever.** A device appends only inside its own directory; nothing is written at the top of `gnotes/`. This is what makes the folder safe in Dropbox, and it is not negotiable — two machines on one path is how the folder loses notes silently.
- Images are stored per device and linked without one: a paste writes `gnotes/<device-id>/images/<sha256>.png`, the block says `![](images/<sha256>.png)`, and main looks in every device's `images/` for the name (`src/main/features/projects/pages/images/images.ts`). The hash name is what makes that safe — the same name is the same bytes — so never store an image under a name that is not its hash, and never in a shared folder at the top of `gnotes/`.
- `seq` detects damage within a device. Ordering across devices is the hybrid logical clock (`hlc`), floored by what has been seen and bounded against a clock set to the wrong year. Never order by `at`; it is for display.
- Never truncate, rewrite or repair a file belonging to another device. A half-arrived foreign log stalls and retries; it must never stop a project from opening. See `docs/multi-writer.md`.
- The renderer reaches main only through `window.pbnotes`; keep new surface behind the context bridge in `src/preload/index.ts`.
- Each component should have an associated story in Storybook.
- Encapsulate by folder
  - Storybook stories and components should remain in the same folder
    - Component B used by component A, and by no one else: safe to place component B's folder inside component A's.
  - A module with a unit test gets a folder named after it, holding both: `src/main/ledger/event-log/{event-log.ts,event-log.test.ts}`. The same nesting rule applies — `window-bounds` is only used by `window-state`, so it lives inside it. A module with no test stays a loose file until it has one.
- For views and front-end-only business logic: use the vertical slice architecture
