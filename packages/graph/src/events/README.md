# Events

Every event a pbnotes folder can hold, one module each. This is the place to add, change, remove or read an event. What each one means to a reader of the folder (its payload, and what a fold does with it) is the contract in the [package README](../../README.md).

```
events/
  events.ts         the namespace, and reading a payload field safely
  blocks/           created/  edited/  deleted/  indented/  outdented/  slice.ts
  properties/       set/  removed/  slice.ts
  tags/             added/  removed/  slice.ts
  aliases/          added/  removed/  slice.ts
  pages/            deleted/  slice.ts
  batch/            the batch event, which holds others (#225)
```

Each `<subject>/<event>/` folder is one event type, `github.com/shovon/pbnotes#<subject's prefix>.<event>`, with its module and its test. Each subject's `slice.ts` lists its events and puts them together as that subject's fold.

What the events of a subject share lives outside this folder, in the subject's own: the state they fold, how a payload is read, the helpers that change the state, the queries and the commands. `tags/tags.ts` has `TagState`, `readTag` and `setTag`; `events/tags/` has the two events that use them.

## An event module

An event is made with its subject's `define`, and its parts are all written against its own payload type, so they are checked against each other:

```ts
// events/aliases/added/added.ts
export const ALIAS_ADDED = ALIAS.define({
  type: namespaced("alias.added"),
  v: 1,
  parse: readAlias,
  apply: (state, it) => setAlias(state, it, true),
  undo: {
    inverse: (state, it) =>
      answersTo(state, it.page, it.alias) ? [] : [aliasRemoved(it.page, it.alias)],
    touched: (_, it) => [same((now) => answersTo(now, it.page, it.alias))],
  },
});

/** The `alias.added` event: `page` answers to `alias`. */
export function aliasAdded(page: string, alias: string): Written<Named<"alias.added">, AliasAdded> {
  return ALIAS_ADDED.build({ page, alias });
}
```

| Part | What it is |
|---|---|
| `type` | The event's name, as it is written: `namespaced("…")`. |
| `v` | The payload version this build reads and writes. Beside it, say why it is that number if it is not 1. |
| `parse(payload)` | The payload as this build reads it, or `undefined` when it is malformed. A malformed payload is skipped whole, never folded in part. Fields it does not read are ignored. |
| `apply(state, it)` | The fold. Hands back `state` itself for a change that changes nothing, and never changes what it is handed. |
| `landed(state, it)` | Optional. Whether a prediction already shows the event, for one that is not safe to fold twice (`block.created`, the moves). Left off, a prediction always folds it. |
| `undo` | `{ inverse, touched }`: the events that undo it, from the state just before it, and what a step must find as it left it (#233). Or `"cannot"`, for an event no existing event can reverse. Never left off. |
| The builder | A function beside it, such as `aliasAdded`, that calls `build`. It states its return type (`Written<…>`). |

## Adding an event

1. **Make its folder:** `events/<subject>/<event>/<event>.ts` and `<event>.test.ts`. The test covers its `parse` (well formed, malformed, extra fields), its `apply`, its builder writing its own `type` and `v`, and its undo.
2. **Add it to its subject's list,** `EVENTS` in `slice.ts`. That is all the wiring there is: `HANDLES`, `UNDO`, the fold, batches, predictions and the event union (`AliasEvent` and the rest) all come from the list.
3. **Export its builder** from `graph.ts` if anything outside the package writes it.
4. **Add it to the test that pins every name and `v`,** in `graph.test.ts` ("the event names and their v are exactly these"). That test is the one place a name or `v` is written out twice on purpose.

The build refuses an event in the list with no `undo`, and the load-order test in `graph.test.ts` finds the new module on disk by itself.

## Changing an event

A name and a `v` never get a new meaning: once a log holds an event, every reader of that folder sees it forever.

- **A payload that changes shape gets a new `v`.** Raise `v`, and update the pinned test. A build that reads the new `v` still reads every lower one: `graphFold`'s gate lets them through, so `parse` has to read the old shapes too. `block.edited` at `v: 2` reads its `v: 1` payloads by ignoring the `page` they carry.
- **`parse` is handed the payload, not its `v`.** An older payload has to be readable by its shape alone. A change that cannot be told apart that way needs `parse` to be given the `v` first.
- **A field that an older build can safely ignore keeps the `v`.** `parent` (#226) and `first` (#231) are on `block.created` at `v: 1`: an older build puts the block at the end of the page instead of dropping it.
- **A new kind of event gets a new name,** never an old name with a new meaning.

## Removing an event

An event a log may already hold is never removed. Logs keep it forever, and a build without its module would skip it, which shows the user's folder differently. To stop writing one, remove its builder's callers and its commands, and keep the module: it still folds what is on disk.

## Rules the modules keep

- **Nothing is built while a module loads.** Events that undo each other import each other (`alias.added` builds `alias.removed`, and the reverse). That works as long as a builder is only called inside a function. The load-order test imports every event module first, in a fresh process each, and fails with a `ReferenceError` if one builds an event at the top level.
- **A builder states its return type.** Two builders that call each other have types that depend on each other, which TypeScript cannot infer.
- **An event module imports its subject's file, never its subject's `slice.ts`.** The list imports the events, so an event importing the list would be a cycle.
- **What a subject's events share goes in the subject's own file,** not in one event's module, so neither event depends on the other for it.

## A new subject

1. Its state and what its events share in a folder of its own, with `over<State>()` for its `define` and `slice`: `aliases/aliases.ts` is the smallest example.
2. Its events here, in `events/<subject>/`, and its `slice.ts`.
3. In `graph.ts`, spread its `HANDLES` and `UNDO` into the graph's, and add its `reduce` and `reads` to the two lists of slices (`behindTheGate` and `readable`). Those two lists are kept by hand, and nothing yet checks that a slice is in both.

A slice that is not behind `graphFold`, such as a plugin's beside the graph, uses `slice(...).fold(initial)`, which puts the version gate in front of it.
