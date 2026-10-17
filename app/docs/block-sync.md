# Blocks under sync

*Status: the reducer semantics are deferred. See [Deferred](#deferred-what-the-reducer-still-gets-wrong).*

[multi-writer.md](../../packages/ledger/multi-writer.md) is the spec for the ledger: how several machines write events into one folder and every one of them folds the same order. It says nothing about what an event means. This is the other half: what that order does to blocks and pages, and the rules the block model keeps so that a sync does not lose what someone typed.

The ledger gives convergence. Every device folds the same events in the same order and lands on the same pages. What is left for the block model is intention: whether the page everyone agrees on is the one a person expected.

## What a misordered event does to a page

The ledger orders events with a hybrid logical clock and not a plain counter, because a counter lets a device that has not read the folder yet sort its events before history (see "Why not a plain Lamport counter" in [multi-writer.md](../../packages/ledger/multi-writer.md)). That is the ledger's half of the argument. This is what it would cost a block.

`reduce` is written for events that arrive in causal order, and it fails quietly when they do not:

- Across pages, nothing happens: a block belongs to one page, so events about blocks on different pages never touch the same entry.
- On the same page, text is lost. A `block.edited` folding before its `block.created` finds no such block and returns the state unchanged; the `created` that follows then sets the original text. A block that was created empty and typed into comes back **empty**.
- A `block.created` carrying `after: X` that sorts before `X` exists falls through to the append-at-end fallback: the block survives, at the bottom of the page rather than where it was written.

With the hybrid clock, what remains is bounded: a device writing into a page another is concurrently editing, while its copy is still incomplete, can disagree with causality by the clock skew between the two machines. Seconds or minutes, not a month.

The same goes for an event delivered twice. A second `block.created` with an existing id splices a twin into the tree, which is why the ledger's merge drops a repeated `(device, seq)` before the fold sees it.

## Blocks are addressed by id, not by page

Only `block.created` carries a page. `block.edited`, `.deleted`, `.indented` and `.outdented` carry the block id and nothing else, and the fold finds the block wherever it is.

On disk each of these is under a namespace, `github.com/shovon/pbnotes#block.created` and so on; this document leaves the namespace off for short. The first logs were written with the bare names. Those logs were rewritten once (#39), and a bare name is no longer read (#40): `reduce` ignores it. A build from before #37 does not read the namespaced names: it skips those events.

This is a sync property rather than a tidiness one. A page on a post-creation event is a copy of where the block sat when the user typed — correct on the machine that wrote it, and stale as soon as another machine moves the block. `state[page]` would then miss and `reduce` would return the state unchanged, which is a keystroke lost in silence. Addressed by id, the same event folds correctly no matter what else has happened to the block. It is also what any cross-page move has to be built on, so the shape is settled before the feature that needs it exists, rather than after.

Payloads went to `v: 2`. A `v1` payload needs no upcast — it has a field the fold no longer reads — but the bump matters in the other direction: an older build handed a `v2` event would look up `state[undefined]` and drop it without a word, and at `v: 2` its `HANDLES` gate refuses the event instead. Since #50 nothing reports a refused event: the gate is `pagesFold` in `@pbnotes/pages`, and the ledger's status no longer counts what a fold skipped.

The price is retroactive history. A late-arriving event slots into the middle of the order and the page reshuffles under the user after a sync. Every file-sync notes app has this; it is survivable, and it is the thing to watch for in dogfooding.

## What the ledger cannot repair

A device whose clock is more than a day ahead is reported as `clockSuspect`, and its events do not move anyone else's clock. That protects the order. It does not repair `page`: the page date is a local calendar day chosen by the renderer, so a machine set to 2031 files notes under 2031 and no clock discipline in the log layer can find them again. The status is the only signal the user will get.

The status (`LogStatus`: each writer directory's state, and the paths skipped) is carried alongside the page through the `pages:*` channels. A fold that moved because a file arrived has main send its state over `pages:changed`, the same message a write from this device produces. A yield that is the state already held sends nothing.

## Deferred: what the reducer still gets wrong

None of these block convergence — every device agrees on the same answer. They are about the answer being the one a person expected. Ranked by how much they will actually bite.

1. **`block.outdented` moves blocks it does not name.** Trailing siblings become children, so its effect is defined over whoever the siblings happened to be at fold time, which differs per device. Carrying the explicit ids it moves makes it mergeable. Payload `v: 3` — `v: 2` is the one that dropped `page`. **Do this one before relying on sync daily.**
2. **`block.deleted` has no tombstone.** Device A deletes X while device B writes a block `after: X`. The fallback in `reduce` (`packages/pages/blocks.ts`) keeps the content — the right instinct — but the block lands at the bottom of the page instead of where it was written. A tombstone restores the placement.
3. **`block.indented` no-ops when its `parent` is gone**, silently dropping the user's intent. Deterministic, so both devices drop it identically. Still surprising.
4. **Text is last-writer-wins per block.** Concurrent edits to one block lose one side. The loser is still on disk forever, so it can be surfaced rather than pretended away.

## Limits

**Live collaboration is not reachable this way.** Two people typing in one block with visible cursors needs ordering and liveness guarantees that a sync folder does not have, at any level of effort. The log stays the right local format, but something else has to carry events between machines. At that point Automerge or Yjs stops being overkill for text specifically — until then it buys nothing this spec does not already get.

**Page dates are per-device local days.** A note written at 11pm in Berlin and one written at 3pm in San Francisco are the same moment on different pages. Already true for one traveling user; sync makes it visible. Not a blocker.

## Tests

The ledger's tests cover the order, the stalls and convergence, with events of their own that are not blocks. The block fold is tested without a log in `packages/pages/blocks.test.ts` and `packages/pages/pages.test.ts`, and through one in `src/main/features/projects/pages/pages-store/pages-store.test.ts`. Both write from a single device. Nothing yet tests two devices' block events interleaving, so each deferred item above lands with a test that folds its events in both orders.

## Order of work

The ledger's steps are done: layout and identity, foreign-log reading and watching, ordering. What is left is here, and is the thing to watch in dogfooding.

4. **Reducer semantics**, one item at a time, driven by which anomaly actually shows up. Nothing here blocks convergence — every device already agrees on the same answer — so this is about the answer being the one a person expected.
