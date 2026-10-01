# Ledger

The ledger is the plumbing for a project's events: it takes them in, reconciles writes from different devices, and lets a feature hook in its own projection. Nothing here knows what an event means.

A project has one ledger, kept in `<project>/gnotes/`. Each device appends only inside its own subdirectory, and every device's segments are merged into one ordered stream when read.

## The parts

- `event-log/` writes and reads the files: framing, fsync, crash recovery, segment rollover, the hybrid logical clock, and the merge across devices.
- `projection/` folds that stream into an in-memory state through a reducer, and re-folds when another device's events arrive.
- `project-ledger/` is what a feature uses. It keeps one open log per project and runs every feature's fold over it.
- `device-store.ts` holds this machine's id and what it remembers per project, in `notes.db`.

## Using it from a feature

Define a fold once, at module load, then ask it for a project's view:

```ts
const chatOf = defineFold<Chat, ChatEvent['type']>('chat', {
  reduce,        // (state, event) => state, pure
  initial: [],
  handles: HANDLES,   // event type → the payload version this build folds and writes
});

const view = await chatOf(project);
view.state;                                // read
await view.dispatch('chat.sent', payload); // write: durable and folded once it resolves
```

`deviceOf(project)` gives the device directory for anything a feature stores beside the log without an event, such as images. `onArrival` reports that another device's events were folded in. `closeLedgers` closes every open log at quit.

## Rules a fold has to keep

- Every fold is handed every event. Return the same `state` object for an event that is not yours.
- Never mutate state and never throw. A re-fold starts again from `initial`, and one fold throwing fails the open for the whole project.
- Guard the payload. Another device's build may have written a shape this one does not expect.
- Prefix event type names by feature (`block.*`, `chat.*`); they share one namespace.
- Define folds before any project opens. A feature is imported statically from `index.ts`, never lazily.
- Never open an `EventLog` or a `Projection` on a project's folder yourself. A second appender is a second writer in this device's directory.
