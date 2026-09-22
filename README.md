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
would orphan itself when they do. The path is mutable metadata, the id is not,
so the id is what a rename, a pin or a last-opened time hangs off.

Notes do **not** hang off it. They live in the project's own directory and
travel with it (see below), which is why a project can move without the app's
help and still be whole when it arrives.

An unreachable directory reports `unknown` rather than `missing` and is never
pruned — an unmounted drive, a sleeping network share and a deleted folder are
indistinguishable at the syscall level, and dropping the row would make the
user re-add a project whose notes are sitting safely on the other end of it.

## Two stores, on purpose

| | Holds | Why |
| --- | --- | --- |
| SQLite (`notes.db`) | The projects registry, config, and local conveniences | Generic bookkeeping the user never authored. Losing a row is an annoyance |
| Event log (`<project>/gnotes/`) | **Project content** | The user's own work. A domain-specific record of what they did, which later folds into whatever views the app needs |

### Content lives in the project, not in `userData`

The log is written **inside the directory the user chose**, one log per
project, in a plain `gnotes/` folder.
That is the reason project folders exist: the notes are about the work that is
already there, so they back up with it, sync with it, and travel with it to
another machine. Nuking `~/Library/Application Support/gnotes` must cost the
user nothing but the registry — a list they can rebuild by picking the folders
again. It must never cost them a word they wrote.

Not behind a dot. A dot-directory means *you can safely ignore this*, which is
what `.git` or `.venv` earns by being bookkeeping the user's work survives
without. This log is the system of record: it is the only copy of what they
wrote, and marking it ignorable is how it gets excluded from a backup or swept
out as tool debris. Other content gets its own folders beside it — images and
so on — as the app grows.

### Segments

`gnotes/` holds numbered segments, `0000000000000001.log` upward. Only the
newest is written to; the rest are sealed, and `seq` keeps counting across
them, so the segments concatenated in name order *are* the log.

The numbers are zero-padded to sixteen digits because `ls`, `readdir` and every
archive tool sort names as text, and a fixed width makes text order and
numeric order the same thing forever. Sixteen digits already runs past
`Number.MAX_SAFE_INTEGER`; going wider would only buy digits the code could not
do arithmetic on.

A segment is sealed at **16 MiB or at the local midnight, whichever comes
first**. Size keeps any one file small enough to copy, read or lose on its own.
The daily cut means a segment is a day's work, which is the unit a person
reaches for when they go looking. Local midnight, not UTC: a day means the
user's day.

Rolling happens before the write that would breach the limit, so no segment
ever exceeds it, and an empty segment is never rolled — a record larger than
16 MiB gets a file to itself rather than a fresh file that starts over
budget.

The corollary is that an unreachable project cannot be written to, and says so.
`EventLog.open` creates its parent directories, so writing to an unmounted
drive would invent the path on the local disk and hide the notes behind the
real volume the moment it mounts. `pages-ipc.ts` checks reachability before it
opens a log.

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
| `src/renderer/App.tsx` | Owns the project data and switches between the two views |
| `src/renderer/ProjectsList.tsx` | The project list UI |
| `src/renderer/ProjectView.tsx` | One project: today's page and its blocks |
| `src/main/event-log.ts` | The append-only log: framing, fsync, crash recovery, segment rollover |
| `src/main/projection.ts` | Folds the log into the in-memory view. Main process only |
| `src/main/pages-store.ts` | One pages projection per project, at `<project>/gnotes/` |
| `src/main/pages-ipc.ts` | The `pages:*` channels. Checks the project against the registry, and its directory for reachability, before opening a log |
| `src/shared/pages.ts` | The pages contract. A page is a day; its id is a local `YYYY-MM-DD` |

A page is not a record anywhere. It is the set of blocks carrying its date, so
opening today appends nothing — the log holds what the user did, and reading is
not one of the things they did. The first write of the day is the first event.

## Development

```sh
npm start      # electron-forge start
npm test       # node --test, no framework
npm run lint
npm run make   # build distributables
```
