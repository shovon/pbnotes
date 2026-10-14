# Design

Why pbnotes stores things the way it does. It has two companions: [multi-writer.md](multi-writer.md) is the design of the shared folder in full, and [block-sync.md](block-sync.md) is what sharing it does to blocks and pages.

## Why the `projects` table exists

**Do not delete it.** It has been mistaken for dead code once already.

The app lets the user track directories they care about. The filesystem cannot store that choice — a directory has no way of knowing a user pointed an app at it — so if pbnotes does not persist the list itself, there is no list. Nothing recovers it on next launch. That registry is the entire reason there is a database at all.

It stores user intent, never filesystem contents:

- **which** directories the user chose (nothing is copied or indexed)
- **what** they call them (the name defaults to the basename, but is editable)
- **which** are pinned, and when each was last opened

Anything derivable is deliberately *not* stored: reachability is probed live each render, and ordering is computed by the query rather than kept as a rank column.

### Why a project's id is not its path

A project's id is a UUID, and relocating a project repoints it at the moved directory while keeping that id. Users move and rename directories; anything keyed on the path would orphan itself when they do. The path is mutable metadata, the id is not, so the id is what a rename, a pin or a last-opened time hangs off.

Notes do **not** hang off it. They live in the project's own directory and travel with it (see below), which is why a project can move without the app's help and still be whole when it arrives.

An unreachable directory reports `unknown` rather than `missing` and is never pruned — an unmounted drive, a sleeping network share and a deleted folder are indistinguishable at the syscall level, and dropping the row would make the user re-add a project whose notes are sitting safely on the other end of it.

## Two stores, on purpose

| | Holds | Why |
| --- | --- | --- |
| SQLite (`notes.db`) | The projects registry, config, and local conveniences | Generic bookkeeping the user never authored. Losing a row is an annoyance |
| Event log (`<project>/gnotes/`) | **Project content** | The user's own work. A domain-specific record of what they did, which later folds into whatever views the app needs |

### Content lives in the project, not in `userData`

The log is written **inside the directory the user chose**, one log per project, in a plain `gnotes/` folder. That is the reason project folders exist: the notes are about the work that is already there, so they back up with it, sync with it, and travel with it to another machine. Nuking `~/Library/Application Support/pbnotes` must cost the user nothing but the registry — a list they can rebuild by picking the folders again. It must never cost them a word they wrote.

Not behind a dot. A dot-directory means *you can safely ignore this*, which is what `.git` or `.venv` earns by being bookkeeping the user's work survives without. This log is the system of record: it is the only copy of what they wrote, and marking it ignorable is how it gets excluded from a backup or swept out as tool debris. Other content follows the same rule and sits in the same folder: a pasted image goes in the writing device's directory, beside its segments.

### Segments

`gnotes/` holds **one directory per device**, each holding numbered segments, `0000000000000001.log` upward. Only the newest is written to; the rest are sealed, and `seq` keeps counting across them within that device.

The directory per device is what makes the folder safe to leave in Dropbox: **one writer per file, forever**, so two machines never touch the same path and a sync tool never has a divergence to resolve. `seq` therefore counts within a device rather than across the folder — it detects damage, and ordering is the hybrid logical clock's job. See [multi-writer.md](multi-writer.md), which is the design in full: what a foreign log may and may not be repaired to, and how the clock is floored and bounded. What the reducer still gets wrong when two machines edit the same page at once is in [block-sync.md](block-sync.md).

The one file at the top of `gnotes/` is `LEDGER`, a marker that says the folder is a ledger and which version of the format it holds. A log opens only on a folder that has it, so the app cannot start writing into the wrong directory, and a build refuses a folder written in a format newer than itself and does not misread it. Any other file found at the top is reported rather than folded.

The numbers are zero-padded to sixteen digits because `ls`, `readdir` and every archive tool sort names as text, and a fixed width makes text order and numeric order the same thing forever. Sixteen digits already runs past the largest integer JavaScript can count exactly; going wider would only buy digits the code could not do arithmetic on.

A segment is sealed at **16 MiB or at the local midnight, whichever comes first**. Size keeps any one file small enough to copy, read or lose on its own. The daily cut means a segment is a day's work, which is the unit a person reaches for when they go looking. Local midnight, not UTC: a day means the user's day.

Rolling happens before the write that would breach the limit, so no segment ever exceeds it, and an empty segment is never rolled — a record larger than 16 MiB gets a file to itself rather than a fresh file that starts over budget.

A device's own torn tail is repaired on load, because only its own crash can cause one. **A file belonging to another device is never written to**: under a sync tool "the tail has not arrived yet" is an ordinary state, and truncating it would turn something transient into permanent loss. Such a log stalls — it folds as far as it is intact, reports itself, and tries again on the next change. One stalled device can never stop a project opening.

The corollary is that an unreachable project cannot be written to, and says so. Opening a log creates its parent directories, so writing to an unmounted drive would invent the path on the local disk and hide the notes behind the real volume the moment it mounts. Reachability is therefore checked before anything opens a log.

### Event sourcing

Content is event-sourced: appended as immutable facts and replayed into an in-memory projection when a project opens. A project has one log and one projection; each feature defines a fold over it and sees only its own slice of the state. **Folding happens in main and nowhere else** — the renderer is handed the resulting view and never replays events itself. One folder means one place for the view to be wrong, and it leaves room to move the fold onto a worker thread. Which is why a reducer must stay pure, over state that survives a structured clone.

A write is appended first and folded only once it is durable, so the view can never show something a crash would take back. Nothing is folded away on disk — events persist forever. When boot cost eventually matters, the fix is to cache a *projection* alongside the log ("valid through seq N") and replay only the tail; the log itself stays untouched.

**Do not move content into SQLite**, and do not move the registry onto the log. A relational store as the system of record fixes the shape of the truth forever, and content will not stay tabular. Conversely, the registry is generic bookkeeping that earns nothing from being event-sourced.

## Pages

A page is not a record anywhere. It is the set of blocks carrying its title, so opening a page appends nothing — the log holds what the user did, and reading is not one of the things they did. The first write to a page is its first event. Pages are never created: naming one is enough. The calendar names the journal days, and a link — `[[Mira]]`, `#Mira` or `#[[Mira]]`, all the same page — names everything else. Following a link opens that page, empty until something is written on it; only the days are in the journal stack. Under its own blocks, every page lists what links to it: each page that names it, cut down to the blocks that do, edited in place like any other block — a write there is a write to the page the block is on. The cuts are read from the fold in main, with the same parser the renderer draws links with, so what counts as a reference is exactly what shows as a link.

## Main holds the state

Main holds the state and the renderer draws it. Which project is open, the trail of links followed, the pages at the end of it, what links to each and what every block ref quotes are all in main, and reach the window one way: the whole of it, in a single message. A write from this window, a link followed, and a step back each ask main for something and resolve once the state that came of it has been sent; none of them answers with a page. Main writes to the log first and folds second, so its state is never ahead of the disk. So that a key does not wait on that, the page draws its own writes in flight over main's state — the text just typed, the block Enter just wrote — using main's reducer, and drops each one when main answers; a write main refuses goes back to what main has. The renderer keeps only what lasts as long as a gesture — the text in an open box, the caret, where the page is scrolled — so no call names a project, and nothing below the top-level view knows there is more than one.

The folder is shared, so the page can change without anyone here touching it. Main watches each open project's folder, re-folds when something lands, and sends the state again if that project is the one open — the same message a write produces, so another machine's edit reaches the screen the way this one's does. A re-fold that read an unchanged log is not news and sends nothing.
