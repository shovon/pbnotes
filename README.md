# gnotes

Notes attached to project directories, kept locally.

## Why the `projects` table exists

**Do not delete it.** It has been mistaken for dead code once already.

The app lets the user track directories they care about. The filesystem cannot
store that choice — a directory has no way of knowing a user pointed an app at
it — so if gnotes does not persist the list itself, there is no list. Nothing
recovers it on next launch. That registry is the entire reason there is a
database at all.

It stores user intent, never filesystem contents:

- **which** directories the user chose (nothing is copied or indexed)
- **what** they call them (`name` defaults to the basename, but is editable)
- **which** are pinned, and when each was last opened

Anything derivable is deliberately *not* stored: reachability is probed live
each render, and ordering is computed in `ORDER BY` rather than kept as a rank
column.

### Why a project's id is not its path

`Project.id` is a UUID, and `relocateProject` repoints a moved directory while
keeping that id. Users move and rename directories; anything keyed on the path
would orphan itself when they do. The path is mutable metadata, the id is not.
Notes will hang off that id, which is why it has to survive a move.

For the same reason, an unreachable directory reports `unknown` rather than
`missing` and is never pruned — an unmounted drive, a sleeping network share
and a deleted folder are indistinguishable at the syscall level, and dropping
the row would discard what the user wrote.

## Two stores, on purpose

| | Holds | Why |
| --- | --- | --- |
| SQLite (`notes.db`) | The projects registry, config, and local conveniences | Generic bookkeeping the user never authored. Losing a row is an annoyance |
| Event log (`000001.log`) | **Project content** | The user's own work. A domain-specific record of what they did, which later folds into whatever views the app needs |

Content is event-sourced: appended as immutable facts and replayed into
in-memory projections at boot. **Folding happens in main and nowhere else** —
the renderer is handed the resulting view and never replays events itself. One
folder means one place for the view to be wrong, and it leaves room to move the
fold onto a worker thread. Which is why a reducer must stay pure, over state
that survives a structured clone.

`Projection.dispatch` appends first and folds only once the write is durable,
so the view can never show something a crash would take back. Nothing is folded away on disk — events persist
forever. When boot cost eventually matters, the fix is to cache a *projection*
alongside the log ("valid through seq N") and replay only the tail; the log
itself stays untouched.

**Do not move content into SQLite**, and do not move the registry onto the log.
A relational store as the system of record fixes the shape of the truth
forever, and content will not stay tabular. Conversely, the registry is
generic bookkeeping that earns nothing from being event-sourced.

## Layout

| Path | Role |
| --- | --- |
| `src/main/db.ts` | SQLite (`node:sqlite`) at `userData/notes.db`, WAL, append-only migrations keyed on `PRAGMA user_version` |
| `src/main/projects-store.ts` | All SQL. Path canonicalisation and case-folded dedupe live here |
| `src/main/projects-ipc.ts` | The ten `projects:*` channels, with argument type-guards |
| `src/preload/index.ts` | Exposes only `window.gnotes.projects` across the context bridge |
| `src/shared/projects.ts` | Types and channel names shared by all three processes — keep it free of `node:` imports |
| `src/renderer/App.tsx` | The project list UI |
| `src/main/event-log.ts` | The append-only log: framing, fsync, crash recovery |
| `src/main/projection.ts` | Folds the log into the in-memory view. Main process only |

## Development

```sh
npm start      # electron-forge start
npm test       # node --test, no framework
npm run lint
npm run make   # build distributables
```
