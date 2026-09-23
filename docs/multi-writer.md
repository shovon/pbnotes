# Multi-writer logs

*Status: implemented, except the deferred reducer semantics — see
[Deferred](#deferred-what-the-reducer-still-gets-wrong).*

The log was designed for one writer. Put the project folder in Dropbox and
that assumption stops holding: two machines replay to the same `seq`, both
decide the next event is `seq + 1`, and both write it into the same path.
Dropbox resolves that by keeping one version and renaming the other to
`0000000000000001 (conflicted copy).log` — a name that fails
`SEGMENT_PATTERN` and is filtered out at load. The other machine's notes are
sitting in the folder, and the app skips them without a word.

This spec makes the folder safe for a sync tool that no one is supervising.
It is scoped to **one user, several machines, eventual convergence**. Live
collaboration is out of scope and is discussed under [Limits](#limits).

## The invariant

> **One writer per file, forever.**

Everything else follows from it. Two machines never touch the same path, so a
sync tool never has a divergence to resolve, so conflicted copies stop being a
case to handle and start being impossible.

## Device identity

A device id is a `randomUUID()` minted on first run and stored in `notes.db`.

It lives in SQLite rather than in the project folder because the project
folder is the thing that gets copied. Restore a machine from a backup, clone a
VM, or hand the folder to a second laptop, and anything stored inside it comes
along — including, fatally, the claim to a log path. `userData` does not
travel, which is exactly the property the device id needs.

This keeps the promise in the README that wiping `userData` costs nothing but
the registry: a machine that loses its device id mints a new one, starts a new
directory, and goes on reading every log already in the folder. It litters a
directory. It loses nothing.

### Duplicate ids heal themselves

The one event that would reintroduce the original bug is two machines sharing
a device id. Two checks, both cheap, and the second is the one that matters:

1. A file inside **our own** device directory that ends in `.log` but fails
   `SEGMENT_PATTERN` is a conflicted copy of a file only we are supposed to
   write. Reliable when it fires, but it only fires after both machines have
   already written.
2. **Our own log's tip is ahead of the tip we recorded.** Alongside the clock
   floor, `notes.db` keeps the `(segment, seq)` this device last appended for
   this project. If the log on disk runs past it, records we did not write are
   in a file only we should be writing — which is a duplicate id, detected
   *before* we append rather than after a conflict.

A crash between the log's fsync and the `notes.db` write also leaves the tip
ahead, so check 2 has false positives. That is fine, because the response is
free: mint a new device id, start a fresh directory, read the old one as a
foreign log. No prompt, no refusal to accept typing, nothing lost — the same
path a machine takes when it loses `userData`.

Note what does *not* work: keeping a local secret and comparing it to an id
published in the folder. Cloning a machine copies the secret along with
everything else, so both halves of the clone agree with themselves.

## Layout

```
<project>/gnotes/
  <device-id>/0000000000000001.log
  <device-id>/0000000000000002.log
  <other-device-id>/0000000000000001.log
```

Segment naming, sealing and rollover are unchanged: sixteen digits, 16 MiB or
local midnight, only the newest written to. Sealing gets *more* valuable here —
a sealed segment never changes again, so a sync tool uploads it once and leaves
it alone. Only each device's hot file churns, and the daily roll bounds how
large it gets.

**Root-level `*.log` files are ignored.** Existing dogfooding logs hold
throwaway data and are not worth a migration path; they are listed in the
status surface so the skip is visible rather than silent, and never folded.
This is a deliberate one-time break, and it is what lets the envelope below
require its new fields instead of treating them as optional.

## The envelope

```ts
export type LogEvent<T = unknown> = {
  /** Gap-free within this device's log. Detects damage; does not order. */
  seq: number;
  /** Which device wrote it. Also the directory the event lives in. */
  device: string;
  /** Hybrid logical clock. Orders the merged log. See below. */
  hlc: { l: number; c: number };
  id: string;
  type: string;
  v: number;
  /** Wall clock, display only. Still never trusted to order anything. */
  at: string;
  payload: T;
};
```

`seq` is demoted, not removed. It was doing three jobs — total order, damage
detection, and write arbitration. Arbitration is now the directory layout's
job, ordering is the clock's, and `seq` keeps damage detection, which is the
one it can still do: a logical clock jumps when it hears a higher one, so a gap
in it means nothing, while a gap in `seq` still means bytes went missing.

`at` stays exactly what it is — the wall clock, for display, ordering nothing.
It is deliberately not the same field as `hlc.l`, which is a wall clock that
has been clamped and is therefore sometimes not the time.

## Ordering

The merged order is **`(hlc.l, hlc.c, device)`**, ascending, with the device id
as a lexicographic tiebreak for genuinely concurrent events. Every machine
computes the same order from the same set of events, which is the whole point.

### The clock

A **hybrid logical clock**: wall-clock milliseconds as the base, forbidden from
falling below anything already observed.

```ts
// `highest` is the greatest (l, c) over every event folded from every device,
// floored by the value persisted for this project in `notes.db`.
const pt = Date.now();
const hlc =
  pt > highest.l
    ? { l: pt, c: 0 }
    : { l: highest.l, c: highest.c + 1 };
```

This does not contradict the reasoning already written into `LogEvent`.
*Clocks run backwards, `seq` does not* stays true: a machine whose clock jumps
backwards cannot drag the order backwards, because `highest.l` floors it and
the counter takes over from there. An HLC is a wall clock that is not allowed
to go below what it has seen.

`highest` is also **persisted per project in `notes.db`** and taken as a floor
on every open. The fold alone cannot see a folder that *regresses* — selective
sync dropping files, online-only placeholders, a directory someone pruned — and
a clock that walks backwards with it writes events that sort into the middle of
history.

### The floor is bounded, or one bad clock poisons everything

An event may raise `highest` only if its `l` is within **24 hours of local
physical time**. Beyond that it is still folded — it is a real event and the
user wrote it — but it does not move the clock.

Without the bound, a floor that only ever rises is a trap. One machine with a
clock set to 2031 writes a single event; every device that reads it adopts
`l = 2031`, persists it, and from then on writes with the counter because `pt`
is never greater. The clock has silently degraded to a plain counter — and the
next device to join, with a correct clock, writes `l = 2026` and sorts before
everything. That is exactly the catastrophe the hybrid clock was chosen to
prevent, re-entering through the floor.

The bound is generous on purpose. Real skew between consumer machines is
seconds to minutes; a day is far outside it and still far inside "the clock is
set to the wrong year."

A device whose events are refused by the bound appears in `LogStatus` as
`clockSuspect`. That surface is the only signal the user will get, and it needs
one, because **nothing here repairs `page`**: the page date is a local calendar
day chosen by the renderer, so a machine set to 2031 files notes under 2031 and
no clock discipline in the log layer can find them again.

### Why not a plain Lamport counter

Because of the case it gets catastrophically wrong, which is also the most
ordinary way a second machine joins.

A Lamport counter is correct only if the new device read the existing log
before it wrote. Usually it does — `EventLog.open` replays before it appends,
which under one writer was about not writing past a torn tail, and here quietly
becomes the thing that makes the clock correct.

But: fresh install on a second laptop, folder handed to the sync tool, user
starts typing while a month of segments is still downloading or sitting there
as placeholders. The fold sees an empty directory, `highest` is zero, and the
first event is written as `1`. A note typed in month two now sorts before every
event of month one — **and the log is append-only, so that number can never be
corrected.**

It is not a cosmetic mis-ordering. `reduce` is written for events that arrive
in causal order, and it fails quietly when they do not:

- Across pages, nothing happens: different `page` keys never interact.
- On the same page, text is lost. A `block.edited` folding before its
  `block.created` finds no such block and returns the state unchanged; the
  `created` that follows then sets the original text. A block that was created
  empty and typed into comes back **empty**.
- A `block.created` carrying `after: X` that sorts before `X` exists falls
  through to the append-at-end fallback: the block survives, at the bottom of
  the page rather than where it was written.

The hybrid clock removes the failure rather than narrowing it. A device that
has seen the history gets strict causality from the clamp. A device that has
seen *nothing* still reads its own clock, and month two is greater than month
one, so it sorts after a history it has never laid eyes on.

What remains is bounded: a device writing into a page another is concurrently
editing, while its copy is still incomplete, can disagree with causality by the
clock skew between the two machines. Seconds or minutes, not a month.

### Convergence without commutativity

Given a deterministic order and a full re-fold, every device lands on the same
state whether or not the operations commute. Non-commutativity then costs
*intention preservation* — the merged tree may not be what either machine
pictured — but never *convergence*. Nobody's copy disagrees with anybody
else's.

That is what keeps `reduce` exactly as it is: pure, deterministic, over a
single total order. No CRDT, no operational transform, no new dependency.

The price is retroactive history. A late-arriving event slots into the middle
of the order and the page reshuffles under the user after a sync. Every
file-sync notes app has this; it is survivable, and it is the thing to watch
for in dogfooding.

### The merge is not a sort

Within one device, `(l, c)` is strictly increasing — every local event is taken
above `highest`, which already includes that device's own past. **So every
device's log is already in merge order**, and the fold is a k-way merge of
sorted streams rather than a sort of the whole history. Memory stays bounded
and the existing streaming reader survives.

The merge also **drops a repeated `(device, seq)`**. Duplicate events are not
hypothetical: a restored file, a copied folder, or a conflicted copy renamed
back into place all deliver history the fold has already seen, and a second
`block.created` with an existing id splices a twin into the tree. Because each
device's stream is sorted by `seq`, deduping is a comparison against the last
value pulled from that stream — no set of every id in history.

### Local appends stay incremental

A local append's `(l, c)` is strictly greater than every event known at that
moment, so it sorts last, so folding it onto the current state is identical to
re-folding everything. Typing does not pay for the merge.

**Remote arrivals trigger a full re-fold** from scratch, reusing the startup
path. It is the lazy correct option and it reuses code that already exists.
The re-fold goes through the same `#tail` queue as appends, so an in-flight
local write cannot be lost to a fold that started before it.

> `ponytail:` full re-fold per remote change, O(log size). Fold incrementally
> by merging the arrived tail in order, or cache the projection if a busy
> folder makes it show. Note the cache's "valid through" is now a `seq` **per
> device**, not one number, and it belongs in `userData` with everything else
> derived — never in the synced folder.

## Reading foreign logs

This is a change of posture more than of algorithm. Today the reader assumes
*I wrote everything here, so anything unexpected is damage.* Under a sync tool,
all of the following are routine: a file arrives half-written, grows between
two reads, appears before the segment that precedes it, vanishes under
selective sync, or exists as an online-only placeholder that throws on read.

A log is **own** if its directory name equals our device id, and **foreign**
otherwise.

### Own log: unchanged

Current behaviour exactly. A torn tail on the newest segment is our own crash
and is repaired — including the missing-final-newline case fixed in `de64b95`.
A gap mid-file is real corruption and throws.

### Foreign log: stalls, never fails

> **Never truncate a file this process does not own.**

The tail repair is correct for our own crash and catastrophic for a file that
is merely still arriving; it would make a transient state permanent.

| Condition | Response |
| --- | --- |
| Torn or unreadable tail | Fold to the last good record, remember the offset, mark `stalled`, retry on next change |
| Bad record with intact records after it | Fold up to it, **do not fold past it**, mark `stalled`, retry |
| Gap in `seq` | Same — the missing bytes may still be in flight |
| Missing segment number | Fold up to the gap, mark `stalled`, retry |
| `ENOENT`, `EIO`, placeholder file | Mark `unavailable`, retry |

Folding past a gap is the one thing worse than stopping at it: an event whose
causal predecessor is missing builds a tree that is quietly wrong, and quietly
wrong is the failure this codebase is built to avoid.

The headline consequence, and the answer to *"nothing in the app lets the user
recover from that"*:

> **A foreign log can never prevent a project from opening.** One stalled
> device costs that device's tail. Every other device still folds.

A stall is not an error state to clear; it is a normal condition that usually
heals on its own when the rest of the file arrives.

## Noticing change

`fs.watch` on `<project>/gnotes/` with `recursive: true`, debounced ~500 ms,
plus a 30-second poll as a backstop. On a change: rescan the device
directories, read what grew, re-fold.

Watching is not optional garnish. Without it, per-device directories fix the
file layer and another machine's notes still do not appear until restart,
because the log is read exactly once at open.

> `ponytail:` recursive watch plus a coarse poll. Per-file offsets and a
> single incremental reader if the poll shows up in battery or CPU.

## Events from a newer build

`reduce` ends in a bare `return state`, so an event type it does not recognise
is skipped. Under one writer that is unreachable: a log only ever holds events
the build that wrote it understood. Under sync it is routine — an older build
on one machine reads what a newer build on another wrote, and **renders an
incomplete page with no indication that anything is missing.**

That is the quietly-wrong failure this codebase is otherwise built to refuse.
It is not worth a version-negotiation protocol; it is worth counting. The fold
tallies event types it does not handle and payload `v` values above what it can
upcast, and `LogStatus` reports them, so the app can say the project holds
notes written by a newer gnotes rather than showing a page with holes in it.

Skipping stays the behaviour — refusing to open would make one new event type
on one machine lock the user out of their notes everywhere.

## Status surface

```ts
type DeviceStatus = {
  device: string;
  /** Last `seq` folded from this device. */
  folded: number;
  state: 'ok' | 'stalled' | 'unavailable' | 'clockSuspect';
  /** Byte offset and reason, when stalled; the offending `l`, when suspect. */
  detail?: string;
};

type LogStatus = {
  devices: DeviceStatus[];
  /** Paths skipped: root-level segments, conflicted copies, junk. */
  ignored: string[];
  /** Event types, and payload versions, this build could not fold. */
  unhandled: { type: string; v: number; count: number }[];
};
```

Carried alongside the page through the existing `pages:*` channels. No UI is
specified here; the requirement is only that nothing gets skipped silently,
which is the sin that made the original bug invisible.

## Deferred: what the reducer still gets wrong

None of these block convergence — every device agrees on the same answer. They
are about the answer being the one a person expected. Ranked by how much they
will actually bite.

1. **`block.outdented` moves blocks it does not name.** Trailing siblings
   become children, so its effect is defined over whoever the siblings happened
   to be at fold time, which differs per device. Carrying the explicit ids it
   moves makes it mergeable. Payload `v: 2`. **Do this one before relying on
   sync daily.**
2. **`block.deleted` has no tombstone.** Device A deletes X while device B
   writes a block `after: X`. The fallback at `pages-store.ts` keeps the
   content — the right instinct — but the block lands at the bottom of the page
   instead of where it was written. A tombstone restores the placement.
3. **`block.indented` no-ops when its `parent` is gone**, silently dropping the
   user's intent. Deterministic, so both devices drop it identically. Still
   surprising.
4. **Text is last-writer-wins per block.** Concurrent edits to one block lose
   one side. The loser is still on disk forever, so it can be surfaced rather
   than pretended away.

## Limits

**Live collaboration is not reachable this way.** Two people typing in one
block with visible cursors needs ordering and liveness guarantees that a sync
folder does not have, at any level of effort. The log stays the right local
format, but something else has to carry events between machines. At that point
Automerge or Yjs stops being overkill for text specifically — until then it
buys nothing this spec does not already get.

**Page dates are per-device local days.** A note written at 11pm in Berlin and
one written at 3pm in San Francisco are the same moment on different pages.
Already true for one traveling user; sync makes it visible. Not a blocker.

## Tests

`node --test`, in the existing style, no framework.

- Two devices' logs fold to the same state regardless of the order the
  directories are read in.
- A foreign torn tail is **not** truncated, folds to the last good record, and
  heals when the rest of the file lands.
- A foreign log damaged mid-file stalls that device and the project still
  opens with every other device's content intact.
- A device directory appearing after open is picked up.
- A local append sorts after everything known, and folding it incrementally
  equals a full re-fold.
- The clock advances past a higher remote value, and past a wall clock that
  has jumped backwards.
- A device that has never seen another's log — an empty or still-downloading
  folder at first write — still sorts its events after that log once it
  arrives.
- The persisted floor survives a folder that loses files between two opens.
- An event dated years ahead is folded but does not raise the floor, and its
  device is reported as `clockSuspect`.
- A duplicated segment file folds once, not twice.
- An unrecognised event type is skipped, counted, and reported in `unhandled`.
- A conflicted copy inside our own device directory mints a new device id, as
  does a tip on disk that runs past the one recorded in `notes.db`.
- Root-level segments and junk files appear in `ignored`, not in the fold.

### The one that matters

**Convergence is a property, not an example.** The tests above are cases; this
is the claim:

> Given the same set of events, every device folds to the same state,
> regardless of the order in which they arrive.

Test it as a property. Generate several synthetic device logs, deliver them to
a fold in randomised orders — delayed, interleaved, truncated mid-segment,
duplicated — and assert every run produces an identical projection. No sync
tool and no second machine required: arrival order is the only thing Dropbox
actually varies, and it is a parameter.

This will find more than the rest of the list put together, because it tests
the invariant the whole design rests on rather than the situations we thought
to imagine.

## Order of work

Steps 1 to 3 are done. Step 4 is not, and is the thing to watch in dogfooding.

1. ~~**Layout and identity.**~~ Device id in `notes.db`, per-device
   directories, per-device `seq`.
2. ~~**Foreign-log reading and watching.**~~ The stall rules, re-reading on
   change, and the `LogStatus` surface including `unhandled`.
3. ~~**Ordering.**~~ `hlc` and `device` on the envelope, the persisted floor
   and its 24-hour bound, k-way merge with `(device, seq)` dedupe, full re-fold
   on remote change, and the convergence property test.
4. **Reducer semantics**, one item at a time, driven by which anomaly actually
   shows up. Nothing here blocks convergence — every device already agrees on
   the same answer — so this is about the answer being the one a person
   expected.
