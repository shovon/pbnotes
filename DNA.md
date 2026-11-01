# DNA

Nintendo sold playing cards before it made video games. People still call it the same company and credit its "DNA", and usually can't say what that DNA is.

This codebase has a DNA too, and it can be named exactly: **a list of folders the user picked, each holding a ledger.** The product is whatever gets written into those ledgers, and that part can change completely. Today it's blocks, pages and a journal. Tomorrow it could be something else. The folders and the ledger in them don't change.

Before you change something, work out which side of that line it's on. Below the line, a change has to be justified against every folder that already exists. Above it, a change only has to make sense for the product.

## What stays

### A list of folders the user picked

The app remembers which folders the user pointed it at: the `projects` table in `notes.db`, and the `projects:*` IPC. The filesystem can't record that choice, so this table is the only thing that remembers it. It is not scaffolding. It has been deleted by mistake once already.

- It holds what the user chose (which folders, what they're called, pinned, last opened), never what they wrote.
- A project's id is a UUID, not its path, so a folder can move and keep its id.
- A folder that can't be reached is reported as `unknown`, never pruned. An unmounted drive and a deleted folder look the same.
- Losing `userData` costs the user this list and nothing else. They pick the folders again and everything is still there.

"Project" is this codebase's name for one entry in that list. Whatever the product becomes, there is a list of folders, and each one is a ledger.

### The folder is the ledger

What the user writes lives in the folder they picked, never in `userData`, and never in a dot-directory that marks it as safe to ignore. The folder backs up, syncs and moves like any other folder because that's all it is.

The format is specified in [packages/ledger/multi-writer.md](packages/ledger/multi-writer.md). Its core:

- A `LEDGER` marker at the top, and one directory per writer.
- **A writer directory has one writer at a time, and a writer resumes from what is on disk.** This is why the folder is safe in Dropbox or any other sync tool: two machines never write the same file, so there is never a conflicted copy.
- Segments are append-only. Records are immutable. Nothing is truncated, rewritten, compacted or repaired, least of all another writer's file. A log that stops partway stalls and retries. It never stops a folder opening.
- Events are ordered by the hybrid logical clock. `at` is for display only.
- `openOrCreate` is the only way a ledger comes to exist. Anything that is neither empty nor already a ledger is refused, with no way to force past it.

"Stays" doesn't mean the bytes are frozen. The format isn't settled yet (see the README). It means a format change is versioned in the marker, and a build that meets a newer format refuses the folder rather than misreading it. A user's folder is never quietly reinterpreted.

### The ledger knows no meaning

`@pbnotes/ledger` stores, orders and replays events without knowing what any of them mean. Its interface is the same whatever the product is:

- `openOrCreate(path)` and `inspect(path)` to open or judge a folder. `openWriter` for short-lived writers.
- `writer().post(v, type, payload)` to append.
- `onFold(initial, reduce)` to fold what's there and what arrives later. `reachOf(event)` to say how far a fold reached.
- `status` for what could be read and what was ignored.

It imports only Node builtins. If it ever needs to know what a `block` is, something has gone wrong.

### A product is a fold

A product, or a feature of one, talks to the ledger through one shape:

- A plain object, `{ reduce, initial }`. Pure, over state that survives a structured clone.
- Every fold is handed every event. For any event it doesn't handle, it returns the same `state` object and never throws: one fold throwing fails the open for the whole folder.
- Event types carry a namespace and start with their subject (`…#block.created`). A payload whose shape changes gets a new `v` and is upcast when read. The file is never rewritten.
- A fold can't iterate the log. If it needs the events themselves, it keeps them in its own state.

This is what makes a pivot cheap. A new product is a new fold over the same folders. The old fold's events stay on disk, and the new one either reads them or ignores them.

### Immutable files beside the ledger

`@pbnotes/files` (`save`, `find`) stores files named by their hash in the writing session's own directory, and finds them in any writer's directory. The same name always means the same bytes, which is what makes this safe under sync. Anything that changes is an event on the ledger, never a file beside it.

## What changes

Everything that gives events meaning, and everything that draws them:

- `@pbnotes/pages`: the `block.*` and `property.*` events, the fold, its queries and commands, `predict`, the journal and the link syntax.
- The app's `pages:*` IPC, `Command`, `Place`, `PlaceView`.
- The renderer, all of it.
- The CLI's `pbnotes append`, which writes `block.created`.

These should be easy to change. Don't write rules for them as if they were permanent, and don't let them leak below the line: the ledger never imports `pages`, and the projects registry never imports anything a project contains.

### What a pivot can't undo

Every event already written stays in users' folders forever. A pivot can stop writing `github.com/shovon/pbnotes#block.*` events, but it can't take back the ones on disk. So the event schema of every product that ever shipped outlives that product's code, as a record of what was written. A later product either folds those events (to migrate or show old notes) or skips them under the fold contract. It never deletes or rewrites them.

## Not decided yet

- **Who owns the namespace.** Is `github.com/shovon/pbnotes#` the namespace for every product's events, or does it belong to the current vocabulary, so a new product would get its own?
