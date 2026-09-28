# gnotes

Notes attached to project directories, kept locally.

## Why the `projects` table exists

**Do not delete it.** It has been mistaken for dead code once already.

The app lets the user track directories they care about. The filesystem cannot store that choice — a directory has no way of knowing a user pointed an app at it — so if gnotes does not persist the list itself, there is no list. Nothing recovers it on next launch. That registry is the entire reason there is a database at all.

It stores user intent, never filesystem contents:

- **which** directories the user chose (nothing is copied or indexed)
- **what** they call them (`name` defaults to the basename, but is editable)
- **which** are pinned, and when each was last opened

Anything derivable is deliberately *not* stored: reachability is probed live each render, and ordering is computed in `ORDER BY` rather than kept as a rank column.

### Why a project's id is not its path

`Project.id` is a UUID, and `relocateProject` repoints a moved directory while keeping that id. Users move and rename directories; anything keyed on the path would orphan itself when they do. The path is mutable metadata, the id is not, so the id is what a rename, a pin or a last-opened time hangs off.

Notes do **not** hang off it. They live in the project's own directory and travel with it (see below), which is why a project can move without the app's help and still be whole when it arrives.

An unreachable directory reports `unknown` rather than `missing` and is never pruned — an unmounted drive, a sleeping network share and a deleted folder are indistinguishable at the syscall level, and dropping the row would make the user re-add a project whose notes are sitting safely on the other end of it.

## Two stores, on purpose

| | Holds | Why |
| --- | --- | --- |
| SQLite (`notes.db`) | The projects registry, config, and local conveniences | Generic bookkeeping the user never authored. Losing a row is an annoyance |
| Event log (`<project>/gnotes/`) | **Project content** | The user's own work. A domain-specific record of what they did, which later folds into whatever views the app needs |

### Content lives in the project, not in `userData`

The log is written **inside the directory the user chose**, one log per project, in a plain `gnotes/` folder. That is the reason project folders exist: the notes are about the work that is already there, so they back up with it, sync with it, and travel with it to another machine. Nuking `~/Library/Application Support/gnotes` must cost the user nothing but the registry — a list they can rebuild by picking the folders again. It must never cost them a word they wrote.

Not behind a dot. A dot-directory means *you can safely ignore this*, which is what `.git` or `.venv` earns by being bookkeeping the user's work survives without. This log is the system of record: it is the only copy of what they wrote, and marking it ignorable is how it gets excluded from a backup or swept out as tool debris. Other content gets its own folders beside it — images and so on — as the app grows.

### Segments

`gnotes/` holds **one directory per device**, each holding numbered segments, `0000000000000001.log` upward. Only the newest is written to; the rest are sealed, and `seq` keeps counting across them within that device.

The directory per device is what makes the folder safe to leave in Dropbox: **one writer per file, forever**, so two machines never touch the same path and a sync tool never has a divergence to resolve. `seq` therefore counts within a device rather than across the folder — it detects damage, and ordering is the hybrid logical clock's job. See `docs/multi-writer.md`, which is the design in full: what a foreign log may and may not be repaired to, how the clock is floored and bounded, and what the reducer still gets wrong when two machines edit the same page at once.

Nothing is written at the top of `gnotes/`, and files found there are reported rather than folded.

The numbers are zero-padded to sixteen digits because `ls`, `readdir` and every archive tool sort names as text, and a fixed width makes text order and numeric order the same thing forever. Sixteen digits already runs past `Number.MAX_SAFE_INTEGER`; going wider would only buy digits the code could not do arithmetic on.

A segment is sealed at **16 MiB or at the local midnight, whichever comes first**. Size keeps any one file small enough to copy, read or lose on its own. The daily cut means a segment is a day's work, which is the unit a person reaches for when they go looking. Local midnight, not UTC: a day means the user's day.

Rolling happens before the write that would breach the limit, so no segment ever exceeds it, and an empty segment is never rolled — a record larger than 16 MiB gets a file to itself rather than a fresh file that starts over budget.

A device's own torn tail is repaired on load, because only its own crash can cause one. **A file belonging to another device is never written to**: under a sync tool "the tail has not arrived yet" is an ordinary state, and truncating it would turn something transient into permanent loss. Such a log stalls — it folds as far as it is intact, reports itself, and tries again on the next change. One stalled device can never stop a project opening.

The corollary is that an unreachable project cannot be written to, and says so. `EventLog.open` creates its parent directories, so writing to an unmounted drive would invent the path on the local disk and hide the notes behind the real volume the moment it mounts. `pages-ipc.ts` checks reachability before it opens a log.

Content is event-sourced: appended as immutable facts and replayed into in-memory projections at boot. **Folding happens in main and nowhere else** — the renderer is handed the resulting view and never replays events itself. One folder means one place for the view to be wrong, and it leaves room to move the fold onto a worker thread. Which is why a reducer must stay pure, over state that survives a structured clone.

`Projection.dispatch` appends first and folds only once the write is durable, so the view can never show something a crash would take back. Nothing is folded away on disk — events persist forever. When boot cost eventually matters, the fix is to cache a *projection* alongside the log ("valid through seq N") and replay only the tail; the log itself stays untouched.

**Do not move content into SQLite**, and do not move the registry onto the log. A relational store as the system of record fixes the shape of the truth forever, and content will not stay tabular. Conversely, the registry is generic bookkeeping that earns nothing from being event-sourced.

## Layout

### The ledger — `src/main/ledger/`

One folder, both tiers. The append-only log is the system of record, so how it is written, how it recovers and how it is interpreted are one subject and sit together.

| Path | Tier | Role |
| --- | --- | --- |
| `ledger/event-log/event-log.ts` | plumbing | Framing, fsync, crash recovery, segment rollover, the HLC, the merge across devices. `verdict` is the one rule that deletes bytes |
| `ledger/projection/projection.ts` | plumbing | Folds the log into an in-memory view through a `Reducer<S>`. Knows nothing about pages. Main process only |
| `ledger/pages-store/pages-store.ts` | domain | What the events *mean*: the `reduce` over a block tree, the commands that author events, the journal and back-reference queries. One projection per project, at `<project>/gnotes/` |
| `ledger/device-store.ts` | adapter | This machine's id and what it remembers per project (clock floor, tip). The one file here that touches SQLite |
| `ledger/pages-ipc.ts` | door | The `pages:*` channels. Checks the project against the registry, and its directory for reachability, before opening a log. Also broadcasts `pages:changed` to every window when a fold moved because a file arrived |

`event-log` and `projection` import nothing but `src/shared/log.ts` — no Electron, no SQLite, no pages. That is worth keeping true. The folder's only other edges outward are `db.ts`, `ipc.ts`, `projects-store.ts` and the shared contracts.

### Registry and shell

| Path | Role |
| --- | --- |
| `src/main/db.ts` | SQLite (`node:sqlite`) at `userData/notes.db`, WAL, append-only migrations keyed on `PRAGMA user_version` |
| `src/main/projects-store.ts` | All registry SQL. Path canonicalisation and case-folded dedupe live here |
| `src/main/projects-ipc.ts` | The ten `projects:*` channels |
| `src/main/ipc.ts` | The `unknown` → string argument guards both IPC files use |
| `src/main/index.ts` | Composition root: opens the database, binds the device, registers both IPC surfaces, makes the window |
| `src/main/window-state/` | Where the main window was last time, and the maths that fits it back onto a display |

### Contracts and renderer

| Path | Role |
| --- | --- |
| `src/shared/log.ts` | What the log can report about itself: devices read, files skipped, events not understood |
| `src/shared/pages.ts` | The pages contract. A page is a title; a journal day is the page titled with its local `YYYY-MM-DD` |
| `src/shared/projects.ts` | Types and channel names shared by all three processes — keep it free of `node:` imports |
| `src/shared/wikilink/wikilink.ts` | The remark plugin that makes `[[Mira]]`, `#Mira` and `#[[Mira]]` links. Shared because main reads a block with the same parser to find what it links to |
| `src/preload/index.ts` | Exposes `window.gnotes.projects` and `window.gnotes.pages` across the context bridge |
| `src/renderer/App/App.tsx` | Owns the project data and switches between the two views |
| `src/renderer/ProjectPicker/ProjectPicker.tsx` | The project list UI |
| `src/renderer/project/ProjectView.tsx` | One project: the journal, or the one page a link led to |
| `src/renderer/project/PageView/PageView.tsx` | One page: its blocks, and what links to it |

A page is not a record anywhere. It is the set of blocks carrying its title, so opening a page appends nothing — the log holds what the user did, and reading is not one of the things they did. The first write to a page is its first event. Pages are never created: naming one is enough. The calendar names the journal days, and a link — `[[Mira]]`, `#Mira` or `#[[Mira]]`, all the same page — names everything else. Following a link opens that page, empty until something is written on it; only the days are in the journal stack. Under its own blocks, every page lists what links to it: each page that names it, cut down to the blocks that do, edited in place like any other block — a write there is a write to the page the block is on. The cuts are read from the fold in main, with the same parser the renderer draws links with, so what counts as a reference is exactly what shows as a link.

The folder is shared, so the page can change without anyone here touching it. Main watches each open project's folder, re-folds when something lands, and pushes the project id over `pages:changed`; the view reads the page again on hearing it. Only that case — a write from this window already holds the page it produced, and a re-fold that read an unchanged log is not news. It is one bit over the bridge rather than the state itself, because what a view wants out of a fold is its own question (one page, the journal, or what links here) and main answers each of those already.

## Development

```sh
npm start      # electron-forge start
npm test       # node --test, no framework
npm run lint
npm run make   # build distributables
```
