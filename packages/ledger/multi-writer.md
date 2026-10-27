# Multi-writer logs

This is the spec for the ledger: an append-only event log that several machines write to through a shared folder, and the fold that reads it. It says nothing about what an event means. That belongs to whoever defines the events and the reducer, called the consumer here.

The log was designed for one writer. Put its folder in Dropbox and that assumption stops holding: two machines replay to the same `seq`, both decide the next event is `seq + 1`, and both write it into the same path. Dropbox resolves that by keeping one version and renaming the other to `0000000000000001 (conflicted copy).log` — a name that is not a segment's, so the reader skips it. The other machine's events are sitting in the folder, and nothing reads them.

This spec makes the folder safe for a sync tool that no one is supervising. It is scoped to **one user, several machines, eventual convergence**. Live collaboration is out of scope: a sync folder has neither the ordering nor the liveness guarantees it needs, at any level of effort.

## The invariant

> **A writer directory has one writer at a time. A writer resumes from what is on disk.**

The ledger enforces both halves. Two machines never touch the same path, so a sync tool never has a divergence to resolve, so conflicted copies stop being a case to handle and start being impossible.

## Writer directories

Nothing on a machine says which directory is its own. There is no device id, and nothing is kept outside the folder (#45). There are two ways to write, and each one decides its directory when it starts.

**`ledger.writer()`** writes to a directory named by a fresh `randomUUID()`. A `Ledger` has one writer, and its directory is created on the first `post`, so a session that only reads leaves nothing behind. The writer never appends to a directory it did not create, so no two writers can share one. A restored backup or a cloned VM is just another session that starts another directory.

**`openWriter(path, key)`** (#61) is for short-lived writers, such as a command that appends one event and exits, which would otherwise leave a directory behind per run. It does not open a `Ledger` and reads no directory but its own. Its directory's name is a UUIDv8 hashed from the boot ID, the OS user, the folder's real path and `key`. It takes an exclusive lock on that name before writing, and carries on from the last record on disk: its `seq`, its segment and size, its day and its clock. The lock is a SQLite database held `EXCLUSIVE` in a per-user folder under the OS temp directory, which must be a directory owned by that user. The OS drops the lock when the process exits, `kill -9` included, and disposing of the writer drops it once every `post` in flight is on disk, so the next writer never resumes in the middle of a record.

The boot ID is in the name because the lock only holds on one machine. Two machines, or two boots of one, derive different names, and so never write one directory between them. The cost is a new directory per key after every reboot.

`openWriter` falls back to a fresh random directory, as `ledger.writer()` does, when it cannot resume:

- there is no boot ID (anything other than macOS and Linux, or one it could not read);
- another process holds the lock, or the lock folder is not this user's;
- the directory's last segment is empty, unreadable, or ends in a torn or undecodable record.

It never repairs the torn tail it finds. It never creates a ledger either: a folder that is not one is refused.

### What is given up

The old design kept a clock floor on each machine, beside the device id, and took it on every open. That is gone, and the floor now comes only from what is on disk (#45, Q1). A `Ledger`'s floor is everything it has folded; `openWriter`'s is the last record in its own directory.

What the kept floor caught was a folder that *regresses*: selective sync dropping files, online-only placeholders, a directory someone pruned. A writer that cannot see history writes on its wall clock instead, and that is still right unless the wall clock is behind the events it cannot see. How far it can be wrong is bounded by clock skew, as under [Why not a plain Lamport counter](#why-not-a-plain-lamport-counter).

## Layout

```
<ledger directory>/
  LEDGER
  AGENTS.md
  <writer-id>/0000000000000001.log
  <writer-id>/0000000000000002.log
  <other-writer-id>/0000000000000001.log
```

A segment's name is sixteen digits. A segment is sealed at 16 MiB or at local midnight, whichever comes first, and only the newest is written to. A record larger than 16 MiB gets a segment to itself, and an empty segment is never rolled. Sealing is worth more under sync: a sealed segment never changes again, so a sync tool uploads it once and leaves it alone. Only each writer's newest file churns, and the daily roll bounds how large it gets.

**`LEDGER` is the only file required at the top**, and is described under [The marker](#the-marker). `AGENTS.md` is written beside it, and is described under [Named extras](#named-extras). Every directory at the top that does not start with a dot is read as a writer directory. Directories written before #50 are named by device id and read as writers that have stopped.

**Any other file at the top is ignored.** That includes `*.log` files from the old single-writer layout, which held throwaway data and are not worth a migration path. They are listed in the status surface so the skip is visible rather than silent, and never folded. This was a deliberate one-time break, and it is what lets the envelope below require its fields instead of treating them as optional. What else may be in the folder is under [What else the folder may hold](#what-else-the-folder-may-hold).

**Event type names were rewritten once.** For one release (#39) the app went through every device's segments before a log opened and gave the five block events of the time their namespaced names. That was a second deliberate break: it changed sealed segments, and it wrote files that belonged to other devices. The code is gone (#40). Nothing rewrites, truncates or repairs a record once it is written, and nothing writes in another writer's directory. A folder that was never opened by that release still holds the old names, and the consumer's gate skips those events (see [Events from a newer build](#events-from-a-newer-build)).

**A subdirectory of a writer directory is left alone.** A consumer may keep things beside a writer's segments that are that writer's to write and that no event carries. `Writer.directory` is where they go. The log does not read them and does not report them. A stray *file* in a writer directory is reported: conflicted copies and junk are files. `@pbnotes/files` keeps to the same layout and claims one such subdirectory by name.

## The marker

Nothing about a directory's shape proves it is a ledger. A log that opened on whatever path it was handed would write a writer directory into the wrong folder and read every subdirectory there as a writer. So a ledger says that it is one, in a file named `LEDGER` at the top of the directory:

```
Signature: bULhVFqraHDHescwKKhK0g==
# This folder is an append-only event ledger. Each subfolder belongs to one
# writing session. Do not edit, rename or delete anything here by hand.
read 1
write 1
```

- **The first line is the signature**: 128 random bits in base64, the same in every ledger there will ever be, and never changed. It is matched exactly. A file named `LEDGER` that does not start with it is not a marker.
- **Lines that start with `#` are skipped.** They are for a person who finds the file. Their wording is not part of the format. Markers written before #45 say "Each subfolder belongs to one device", and every build accepts either.
- **`read N` and `write N`** are the lowest format version a build needs to read the directory and to write to it. Both are required, in that order, and nothing else may follow. Every line ends in one newline.
- **Version 1** is the envelope, the segment names and the layout described in this document. A version goes up for a change an older build would misread. A change an older build already skips, such as a new event type, does not need it.
- **Two numbers and not one**, so that a later format can say that an older build may read but must not write. Nothing reads without writing yet, so a build opens a directory only when it meets both.

This is the one file that more than one writer may write, which the invariant otherwise forbids. It is safe because of what goes in it: nothing that differs between writers, apart from the comment lines of an older build. Every build writes it with an exclusive create, once, and never rewrites it. If the create finds a marker already there, that marker is judged like any other. Two machines that create the same directory before they sync produce identical files, and a conflicted copy of one is reported as a stray file like any other.

### Opening and creating

`inspect(path)` classifies a folder and writes nothing. `openOrCreate(path)` creates a ledger only where `inspect` says `missing`, and refuses everything else that is not a `ledger`:

| The directory | `inspect` | `openOrCreate` |
| --- | --- | --- |
| Holds a valid `LEDGER` with `read` and `write` this build meets | `ledger` | Opens |
| Does not exist, or is empty | `missing` | Writes the marker and the named extras, then opens |
| No `LEDGER`, and a subdirectory holds a segment | `unmarked` | Refuses |
| No `LEDGER`, not empty, no segments | `not-a-ledger` | Refuses |
| `LEDGER` has the wrong signature, or does not parse | `not-a-ledger` | Refuses |
| `LEDGER` asks for a higher `read` or `write` | `newer` | Refuses |

A directory that holds only dotfiles counts as empty: a file manager leaves those in a folder it was merely asked to show. So does one that holds only [named extras](#named-extras), which sync may deliver before the marker. A refusal is a plain `Error` that names the reason. A caller that needs to act on the reason calls `inspect` first. `openWriter` refuses everything but `ledger`, `missing` included.

There is no adopt, and no way to force past a refusal. `unmarked` covers three things that look the same on disk: a directory written before markers existed, one whose marker has not arrived from the sync tool yet, and one whose marker was lost. Telling the user, and offering the fix where it is safe, is #44. A higher version is refused because the log is never rewritten, so a record appended by a build that did not know the format would stay for good.

## What else the folder may hold

The sections above say what a ledger folder must hold. This one says what else may be in it, so that the OS, a sync tool or a later build can leave things there without the folder reading as damaged (#104).

- A writer **must** write the format exactly.
- A reader **must** ignore what the format does not name, as long as ignoring it does not change the fold.
- A build **may** add files the format does not name.

**Extras at the top are files.** Every folder at the top whose name does not start with a dot is a writer directory, so a folder that a build added there would be read as a writer by every build before it. A build that needs a folder at the top changes the format. Writer directories have no name pattern. Every one written so far is named by a UUID, but nothing checks that, and a pattern would protect nothing until every build in use had it. A folder that someone else puts at the top is read as a writer: it is listed in `status.devices`, its files are listed in `status.ignored`, and it folds nothing unless it holds segments.

**Dot-entries are ignored everywhere**, files and folders, at the top and in writer directories. They belong to the OS or a sync tool (`.DS_Store`, `.git`, `.stfolder`, `.stversions`, a partial download), so they are not read and not listed in `status.ignored`. A folder that holds only dot-entries counts as empty.

**Ignored is not silent.** Anything else the format does not name is listed in `status.ignored` and never folded: a file at the top other than `LEDGER`, and a file in a writer directory that is not a segment. That list is how a conflicted copy of a segment gets noticed. A subdirectory of a writer directory is named, under [Layout](#layout), as that writer's own, and is not listed.

**The marker check does not change.** Until `LEDGER` checks out, an extra file is evidence that the folder is not a ledger, and `inspect` still says `not-a-ledger`. If sync delivers an extra before the marker, the open is refused, and that clears once the marker arrives.

**A file at the top that several writers may create** is created with an exclusive create, is never rewritten, and has the same bytes on every build of one format version. Otherwise two machines that create one ledger before they sync leave a conflicted copy of it. `LEDGER` keeps to this, apart from the comment lines of builds before #45.

**Not a back door for format changes.** An addition that an older build would misread by ignoring it is a format change, and `read` or `write` goes up.

### Named extras

The format keeps a list of the extras it knows. A named extra is not listed in `status.ignored`, and a folder that holds only named extras counts as empty, as one holding only dot-entries does.

- **`AGENTS.md`** (#63) tells an agent (Claude Code, Codex and the like) that finds the folder what it is: a ledger written by Pb Notes, with the format described at https://github.com/shovon/pbnotes, and nothing in it to be changed by hand. Without it an agent sees a `LEDGER` file and folders of segments, and may tidy them, edit a segment, or guess at the format. It is a signpost, not part of the format: no build reads it, and a ledger without one is whole.

A named extra is a file at the top that several writers may create, so it keeps to that rule: an exclusive create, never rewritten, and the same bytes on every build of one format version (`NAMED_EXTRAS` in `ledger.ts`). One that is already there is left alone, whatever it holds, so a user's edits survive. A folder with a named extra's name is not one, and is read as a writer like any other folder.

`openOrCreate` writes the named extras after the marker. It writes them on every open, not only on creation, so a ledger made before #63 gets them too. That backfill is for now: #106 limits it to creation. The writes are best effort. A folder that cannot take one, because it is read-only or full, still opens. `openWriter` does not write them.

## The envelope

```ts
export type LogEvent<T = unknown> = {
  /** 1, 2, 3… gap-free within one writer directory. Detects damage; does not order. */
  seq: number;
  /** The writer directory (one writer at a time). Named `device` for format compatibility. */
  device: string;
  /** Orders the merged log (ties broken by `device`). */
  hlc: { l: number; c: number };
  id: string;
  type: string;
  v: number;
  /** Wall clock, for display only. */
  at: string;
  payload: T;
};
```

Each record is one line: the CRC-32 of the JSON in eight hex digits, a space, the JSON, a newline. The keys stay in the order above.

`seq` was doing three jobs: total order, damage detection, and write arbitration. Arbitration is now the directory layout's job, ordering is the clock's, and `seq` keeps damage detection, which is the one it can still do. A logical clock jumps when it hears a higher one, so a gap in it means nothing, while a gap in `seq` still means bytes went missing.

`at` is the wall clock, for display, ordering nothing. It is deliberately not the same field as `hlc.l`, which is a wall clock that has been clamped and is therefore sometimes not the time.

A consumer never sees the envelope. Its reducer and `post` are handed `Event`: `{ type, v, at, payload }`, a fresh frozen copy each time, so that no consumer depends on the log's internals and no reducer can change what another folds.

## Ordering

The merged order is **`(hlc.l, hlc.c, device)`**, ascending, with the directory name as a lexicographic tiebreak for genuinely concurrent events. Every machine computes the same order from the same set of events, which is the whole point.

### The clock

A **hybrid logical clock**: wall-clock milliseconds as the base, forbidden from falling below anything already observed.

```ts
// For a Ledger, `h` is the greatest (l, c) it has folded, from every directory
// and within the bound below. For openWriter, it is the last record in its own directory.
const nextHlc = (h, now) => (now > h.l ? { l: now, c: 0 } : { l: h.l, c: h.c + 1 });
```

*Clocks run backwards, `seq` does not* stays true: a machine whose clock jumps backwards cannot drag the order backwards, because `h.l` floors it and the counter takes over from there. An HLC is a wall clock that is not allowed to go below what it has seen.

### The floor is bounded, or one bad clock poisons everything

An event may raise a `Ledger`'s clock only if its `l` is within **24 hours of local physical time**. Beyond that it is still folded, since it is a real event and someone wrote it, but it does not move the clock.

Without the bound, a floor that only ever rises is a trap. One machine with a clock set to 2031 writes a single event. Every machine that reads it adopts `l = 2031`, and from then on writes with the counter, because its own clock is never ahead. The clock has silently degraded to a plain counter, and the next machine to join with a correct clock writes `l = 2026` and sorts before everything. That is exactly the catastrophe the hybrid clock was chosen to prevent, re-entering through the floor.

The bound is generous on purpose. Real skew between consumer machines is seconds to minutes; a day is far outside it and still far inside "the clock is set to the wrong year."

A directory holding such an event appears in `LogStatus` as `clockSuspect`. That surface is the only signal the user will get, and it needs one, because **nothing here repairs a payload**. The bound keeps a wrong clock out of the order, but whatever the consumer derived from that clock and wrote into an event stays as written, and no clock discipline in the log layer can correct it.

### Why not a plain Lamport counter

Because of the case it gets catastrophically wrong, which is also the most ordinary way a second machine joins.

A Lamport counter is correct only if the writer read the existing log before it wrote. `openOrCreate` waits for its first scan before it returns, so `ledger.writer()` writes only after the fold has read every directory it could. `openWriter` reads nothing but its own directory, on purpose, so for it this is the normal case.

And even a `Ledger` can see an empty folder. A fresh install on a second laptop, the folder handed to the sync tool, and the user starts typing while a month of segments is still downloading or sitting there as placeholders. The fold sees nothing, the floor is zero, and the first event is written as `1`. An event written in month two now sorts before every event of month one, **and the log is append-only, so that number can never be corrected.**

It is not a cosmetic mis-ordering. A reducer is written for events that arrive in causal order, and one that meets an event before the event it depends on fails quietly: it finds nothing to apply the event to and returns the state unchanged.

The hybrid clock removes the failure rather than narrowing it. A writer that has seen the history gets strict causality from the clamp. A writer that has seen *nothing* still reads its own clock, and month two is greater than month one, so it sorts after a history it has never laid eyes on.

What remains is bounded: a writer that cannot see all of the folder can disagree with causality by the clock skew between it and a writer writing at the same time. Seconds or minutes, not a month.

### Convergence without commutativity

Given a deterministic order and a fold over it, every machine lands on the same state whether or not the operations commute. Non-commutativity then costs *intention preservation*, since the merged state may not be what either machine pictured, but never *convergence*. Nobody's copy disagrees with anybody else's.

That is what keeps the consumer's `reduce` simple: pure, deterministic, over a single total order. No CRDT, no operational transform, no new dependency. Intention preservation is the consumer's to work on, in how it shapes its events and its reducer.

The price is retroactive history. A late-arriving event slots into the middle of the order, and the state reshuffles under whoever is looking at it after a sync. Every file-sync app has this; it is survivable.

### The merge

A `Ledger` keeps every event in memory, in merge order. Each batch that arrives, whether from a scan or from its own writer, is appended and the whole array sorted again. The array is nearly sorted already, which keeps that cheap.

> `ponytail:` full sort per batch; a k-way merge of the directories, each already in `(l, c)` order, if posts get hot. The whole log is also re-read on every open; on-disk snapshots when cold start gets slow, kept on the machine and never in the synced folder.

A record is folded **once per `(directory, seq)`**. Duplicates are not hypothetical: a restored file, a copied folder, or a conflicted copy renamed back into place all deliver history the fold has already seen, and a reducer that appends would apply it twice. Each directory has a cursor holding the last `seq` folded from it, and a record at or below it is skipped. Records this ledger's own writer has just written go through the same cursor, so a scan that reads one first and the writer's own hand-off cannot both fold it.

### Refolding from a checkpoint

`onEvent(base, reduce)` yields the folded state once it has caught up, and again after every batch. It keeps the state after every 1000th event as a checkpoint. When a batch arrives, it refolds from the last checkpoint at or before where the batch's earliest event sorted.

A local append is greater than everything this ledger knows, so it sorts last, and folding it costs at most the events since the last checkpoint. A late event from another machine sorts into the past and refolds from the checkpoint before it. Either way the result is the same as a fold from the start. It also means a yielded state is not always a successor of the previous one, and that `reduce` must be pure and must not mutate the state it is handed: checkpoints hold on to it.

A batch from this ledger's own writer is yielded like any other. A scan that read nothing new yields nothing.

## Reading foreign logs

Under a sync tool all of the following are routine: a file arrives half-written, grows between two reads, appears before the segment that precedes it, vanishes under selective sync, or exists as an online-only placeholder that throws on read.

So **every directory is foreign**, even the one this ledger's writer is appending to. Reading never truncates, never writes, and never throws. Each directory is read from its cursor, which only moves past records that were folded or skipped as duplicates. Where reading stops, the cursor stays at the last good record and the next scan tries again.

| Condition | Status |
| --- | --- |
| A segment number is missing and a later one exists | `stalled`: the later segment "follows a missing one" |
| `seq` jumps | `stalled` at the record that jumps |
| A bad record with intact records after it | `stalled` at the bad record; nothing after it is folded |
| A bad or unterminated last record | `stalled`: "torn tail (may be from a crash)" |
| The directory or a segment cannot be listed or read | `unavailable` |
| A `seq` at or below the cursor | Skipped, not a stop |

Folding past a gap is the one thing worse than stopping at it: an event whose causal predecessor is missing builds a state that is quietly wrong, and quietly wrong is the failure this codebase is built to avoid.

> **A foreign log can never prevent the log from opening.** One stalled directory costs that directory's tail. Every other directory still folds.

A stall is not an error state to clear. It is a normal condition that usually heals on its own when the rest of the file arrives. The exception is a writer that crashed in the middle of a record: nobody will come back to finish it, since `ledger.writer()` never resumes and `openWriter` leaves a torn directory for a new one. That directory's tail stalls for good, which is why the reason says it may be from a crash. Telling the user is #44.

## Noticing change

A `Ledger` polls. Each scan lists the top of the folder, then reads the writer directories that are due: it lists each one and reads its segments from the cursor's offset, so only the bytes that grew are read. A new directory is due at once, so it is picked up by the next scan.

There is no `fs.watch`: watch events are unreliable inside sync clients, and a sync client takes seconds to deliver a change anyway, so a one-second poll is already quicker than what it is waiting for. A watch would only speed up writes from this machine, and the poll would still have to be what correctness rests on.

### Cadence

Writer directories pile up: every session that writes leaves one, and `openWriter` leaves one per key per boot. Almost all of them have ended, and an ended directory never changes again. A quiet tick costs about 70 µs per directory on a local disk (72 ms at 1,000 directories, measured for #52), so reading every directory every second makes the cost grow with how long a project has been in use rather than with how much is happening. The ledger tiers directories instead, and the consumer sets the pace.

A `Cadence` is three numbers:

- `everyMs`: the time from the end of one scan to the start of the next.
- `quietAfterMs`: a directory where nothing has changed for this long is quiet.
- `quietEveryMs`: a quiet directory is read at most this often. Every other directory is read on every scan.

A directory has changed when a read sees something different from the last read: a segment appeared or went, or the segment being read is a different size. A directory seen for the first time takes its newest segment's modification time as the time of its last change, so a session that is writing when the ledger opens is read on every scan from the start, and one that ended last week is not. A directory first seen with no segment to go by, empty or unreadable, counts as just changed: sync clients often create a folder before its files, and that folder is a new session whose first segment is about to land. A quiet directory is never skipped for good, because a machine that was offline for a month can sync it at any time. When it changes it is read on every scan again.

Size is enough to tell a change, because the key only decides how often a directory is read, never what a read folds. A read folds whatever bytes are there. So a segment that turns up at its final size before its bytes do, as an online-only placeholder can, stalls and is retried on every scan while the directory is active, and on its quiet reads after that; when the bytes arrive, the next read folds them, whatever the key says.

What counts as a change is only ever what this machine saw, and the modification time is only a first guess. Neither orders anything or decides what is folded, so a sync client that sets odd times can make a directory read more often or less often than it should be, but never wrong. The cadence is timed on a monotonic clock, so a wall clock that is set back cannot stop the reads; the wall clock is only used to turn a first-sight modification time into an age.

`openOrCreate(path, cadence)` takes the starting cadence, and `ledger.pace(cadence)` changes it from the next scan. Both refuse a cadence that is not one (`everyMs` below 1, or any field that is not a finite number of milliseconds, the old `pollMs` number included), and `openOrCreate` does so before it writes anything: a bad cadence would otherwise spin, or never read a directory again, and say nothing. `ledger.refresh()` scans now and reads every directory, quiet or not, and resolves once the scan is done. Scans never overlap: one asked for while another runs waits for it. Refreshes asked for while one is still waiting to start share it, so a burst of them costs one scan; one asked for while it runs gets a scan of its own, because the running one may have read past a change.

What `ledger.status` says about a directory is as of the last read of it. For a quiet directory that is up to `quietEveryMs` old: its state, and the stray files in it, catch up on its next read. A change of state is itself a change, so a directory that has just stalled or become unavailable is read on every scan until it has been that way for `quietAfterMs`.

### The app's pace

The app paces every open ledger by whether one of its windows has focus:

| | `everyMs` | `quietAfterMs` | `quietEveryMs` |
|---|---|---|---|
| Focused (the default) | 1 s | 5 min | 30 s |
| In the background | 5 s | 5 min | 2 min |

When a window gains focus, every open ledger goes back to the focused pace, and the open project's is refreshed, so what comes on screen has been read in full and never lags by the background pace. The app keeps the ledger of every project opened this session, and the others are only paced: reading them all in full on every focus would be paid for projects nobody is looking at. A window that is visible but not focused, such as one beside another app, shows a change from an active directory within 5 s.

## Events from a newer build

The ledger gates nothing. Every event that decodes is handed to the consumer's reducer, whatever its `type` and `v`, and the consumer decides what it can read. In this repo that gate is `pagesFold` in `packages/pages/pages.ts`: an event type this build does not have, or a `v` above what `HANDLES` says it reads, leaves the pages as they were.

Under one writer that case is unreachable: a log only ever holds events the build that wrote it understood. Under sync it is routine. An older build on one machine reads what a newer build on another wrote, and **the consumer shows an incomplete state with no indication that anything is missing.**

That is the quietly-wrong failure this codebase is otherwise built to refuse. It is not worth a version-negotiation protocol, but it is worth counting, so that the consumer can say the folder holds events written by a newer build rather than show a state with holes in it. The ledger used to count them (`unhandled`). Since #45 the consumer must, because only it knows what it skipped, and nothing counts them yet.

Skipping stays the behaviour. Refusing to open would let one new event type on one machine lock the user out of the folder everywhere.

## Status surface

```ts
type DeviceStatus = {
  /** The writer directory's name. */
  device: string;
  /** Last `seq` folded from it. */
  folded: number;
  state: "ok" | "stalled" | "unavailable" | "clockSuspect";
  /** Segment, byte offset and reason, when stalled; the error, when unavailable; the offending date, when suspect. */
  detail?: string;
};

type LogStatus = {
  devices: DeviceStatus[];
  /** Absolute paths skipped: files at the top other than `LEDGER`, and files in a writer directory that are not segments. Dot-entries are not listed. */
  ignored: string[];
};
```

`ledger.status` is read whenever the consumer wants it, and lists directories in name order. How it reaches the user is the consumer's business, and no UI is specified here. The requirement is only that nothing gets skipped silently, which is the sin that made the original bug invisible.

> `ponytail:` a folder whose top cannot be listed keeps the last view; `LogStatus` has no slot to say so.

## Tests

`node --test`, no framework. `ledger.test.ts`:

- Two ledgers on one folder converge, and an event written after reading another sorts after it.
- Records are format 1: CRC-32 hex, a space, JSON with the keys in envelope order.
- A ledger has one writer, and its directory appears on the first `post`.
- Consumers see only `{ type, v, at, payload }`, frozen.
- A late event refolds from a checkpoint to the same state as a fold from the start. A torn tail stalls, and heals when the rest of the record arrives.
- The marker's exact bytes, its strict parse, and each `inspect` verdict. Opening refuses a newer marker, a stranger's folder and an unmarked one.
- A missing segment, a `seq` jump and a damaged record each stall their directory and nothing else, and heal when sync fills them. A duplicate `seq` folds once. An event dated ten days ahead is folded and its directory is `clockSuspect`. A conflicted copy and a stray file at the top are `ignored`; a subdirectory of a writer directory is not.
- Dot-entries are neither read nor listed, at the top or in a writer directory: a `.git` folder holding a segment folds nothing.
- `AGENTS.md`: a new ledger gets its exact bytes, an existing ledger without one gets one, one already there is not overwritten, it is not listed in `ignored`, and a folder holding only it is `missing`. A folder named `AGENTS.md` is read as a writer.

`open-writer.test.ts`:

- One directory is resumed across runs: `seq` carries on, and segments roll by size and by day.
- A second writer with the same key at once, a torn or empty tail, or a lock folder belonging to someone else each get a random directory, and the torn tail is left alone.
- The lock is released by `kill -9`, by leaving an `await using` scope even when it throws, and on dispose only after a `post` in flight. A `post` after dispose rejects.
- The boot ID is part of the directory's name.
- It never creates a ledger, reads no directory but its own, and puts nothing else in the folder. A `Ledger` on the same folder folds what it wrote.

### The one that is missing

**Convergence is a property, not an example.** The tests above are cases; this is the claim:

> Given the same set of events, every machine folds to the same state, regardless of the order in which they arrive.

It is not yet tested as a property. The test would generate several synthetic writer directories, deliver them to a fold in randomised orders (delayed, interleaved, truncated mid-segment, duplicated), and assert that every run produces an identical state. No sync tool and no second machine is needed: arrival order is the only thing Dropbox actually varies, and it is a parameter.

It would find more than the rest of the list put together, because it tests the invariant the whole design rests on rather than the situations we thought to imagine.
