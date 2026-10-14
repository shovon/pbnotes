# Ledger

The ledger is the plumbing for a project's events: it takes them in, reconciles writes from different devices, and lets a feature hook in its own projection. Nothing here knows what an event means.

A project has one ledger, kept in `<project>/gnotes/`. Each device appends only inside its own subdirectory, and every device's segments are merged into one ordered stream when read. A `LEDGER` file at the top says that the directory is a ledger and which version of the format it holds.

## The parts

- `marker/` reads and writes `LEDGER`. It decides whether a directory may be opened at all, and is the only way one becomes a ledger.
- `event-log/` writes and reads the files: framing, fsync, crash recovery, segment rollover, the hybrid logical clock, and the merge across devices.
- `projection/` folds that stream into an in-memory state through a reducer, and re-folds when another device's events arrive.
- `project-ledger/` is what the app's glue (`src/main/index.ts`) uses on a feature's behalf. It keeps one open log per project and runs every feature's fold over it.
- `device-store.ts` holds this machine's id and what it remembers per project, in the app's database.

## Using it for a feature

A feature does not import anything from here. It exports its fold as a plain object and is handed a view:

```ts
// In the feature. No import from the ledger.
export const chatFold = {
  reduce,        // (state, event) => state, pure
  initial: [],
  handles: HANDLES,   // event type → the payload version this build folds and writes
};
```

`src/main/index.ts` registers it once, at module load, and hands the feature its view of whichever project is open:

```ts
const chatOf = defineFold('chat', chatFold);

const view = await chatOf(project);
view.state;                                // read
await view.dispatch('chat.sent', payload); // write: durable and folded once it resolves
```

The feature sees only the view. It is never given the project, its id or its path.

`deviceOf(project)` and `logDirectory(project.path)` give the device directory for anything stored beside the log without an event; `@pbnotes/files` is the store the app uses for that, and it imports nothing from here. It goes in a subdirectory of the device directory, which the log leaves alone and does not report; a stray file there is reported as ignored. `index.ts` builds those paths and hands the feature a function that uses them. `onArrival` reports that another device's events were folded in. `closeLedgers` closes every open log at quit.

Opening a ledger never creates one. A directory with no valid `LEDGER` is refused with a `LedgerRefusedError`, whose `reason` says which of four things was wrong: `missing`, `unmarked`, `not-a-ledger` or `newer`. `createLedger(directory)` makes a ledger where there is nothing, and `adoptLedger(directory)` marks a directory that already holds a log. `beforeOpen` takes a function that is run on a ledger's directory before each open, which is where `index.ts` decides which of those to call.

`renameTypes(directory, names)` in `event-log/` rewrites event type names on disk, in every device's segments. It is temporary (#39, removed by #40), it is called from `beforeOpen` and nowhere else, and it is the only thing here that changes a record after it was written.

There is no way to iterate the log from a feature. One that needs the events themselves has its reducer push each one onto an array in its own fold state.

## Rules a fold has to keep

- Every fold is handed every event. Return the same `state` object for an event that is not yours.
- Never mutate state and never throw. A re-fold starts again from `initial`, and one fold throwing fails the open for the whole project.
- Guard the payload. Another device's build may have written a shape this one does not expect.
- Prefix event type names by feature (`chat.*`, `poll.*`); they share one namespace.
- Define folds before any project opens. Every `defineFold` call is at the top of `index.ts`, at module load.
- Never open an `EventLog` or a `Projection` on a project's folder yourself, from a feature or from the glue. A second appender is a second writer in this device's directory.
