# Pages

What the events in a pbnotes folder mean. The app folds them with this, and any other program that reads or writes the folder should do the same. A program that copies the fold drifts from the app, and when two folds disagree about one folder, one of them is wrong about the user's notes.

```ts
import { openOrCreate } from '@pbnotes/ledger';
import { getPages, getReferences, pagesFold } from '@pbnotes/pages';

const ledger = await openOrCreate(folder);
for await (const pages of ledger.onEvent(pagesFold.initial, pagesFold.reduce)) {
  // the same pages the app shows
}
```

To write, hand `addBlock`, `editBlock`, `deleteBlock`, `indentBlock` or `outdentBlock` a `PagesView`: the state you hold, and a `dispatch(v, type, payload)` wired to your own log. They run the same checks the app runs before they write anything.

Each of those writes one event, and each event has a pure builder: `blockCreated`, `blockEdited`, `blockDeleted`, `blockIndented` and `blockOutdented`. A builder returns `{ v, type, payload }` with `v` from `HANDLES`, so a writer that holds no fold can still write a valid event, but it skips the checks.

The queries (`getPage`, `getPages`, `getReferences`, `getPreviews`, `searchPages` and `locateBlock`) take the folded pages alone, since they never write. So do the property reads under [Page properties](#page-properties).

## What it does not depend on

- **The log.** The fold takes `{ type, v, payload }` and the commands write through `dispatch`. This package does not import `@pbnotes/ledger`, so events can come from anywhere.
- **Node.** There are no `node:` imports. The app's renderer bundles this package, and it runs under plain `node --test`.

## The event names are a contract

Every event type is `NAMESPACE` followed by a name, for example `github.com/shovon/pbnotes#block.created`. `HANDLES` gives the payload `v` that this build reads and writes for each one.

- **A name and a `v` never get a new meaning.** Once a log holds an event, it stays on disk forever, and every reader of that folder will see it. A payload that changes shape gets a new `v`, and a new kind of event gets a new name.
- **The namespace is an identifier, not a link.** Do not change its bytes, even if the repository moves.
- **`pagesFold` is the gate.** It skips a type that is not in `HANDLES` and a `v` higher than `HANDLES` gives, so an older reader passes over what it cannot read and does not fold it wrongly. Do not call `reduce` on events from a log without the gate in front of it.

## Page properties

A page can carry properties: values about the page itself, such as a status, its aliases or a cover. They are a tree. A key is a **path**, a non-empty array of strings, and every node holds a value, a set of items, both, or only what is under it. The events give no key a meaning: what `["app", "cover"]` is, is a rule in whatever reads it. By convention the first segment says who owns a key: `["user", ...]` for what people type, `["app", ...]` for keys the app gives a meaning to.

| Type | Payload | Meaning |
|---|---|---|
| `page.property.set` | `{ page, path, value }` | The value at `path` is now `value`. Its items are untouched. |
| `page.property.unset` | `{ page, path }` | `path` has no value. Its items are untouched. |
| `page.property.item.added` | `{ page, path, item }` | `item` is among the items at `path`. Adding one already there moves it to the end. The value is untouched. |
| `page.property.item.removed` | `{ page, path, item }` | `item` is no longer among them. The value is untouched. |
| `page.property.removed` | `{ page, seen: [{ path, value?, items }] }` | A property removed: for each path in `seen`, the value if it is still the one seen, and each item listed. What is not listed stays. |

Each is `NAMESPACE` followed by its name, at `v: 1`.

- **A scalar** is a string, a finite number, a boolean or `null`, and the four stay distinct: `1`, `"1"`, `true` and `null` are four values. `null` is a value; `unset` is how a path stops having one.
- **The fold trims each path segment and puts every string in NFC,** so `" status "` and `"status"` are one key, and `Café` typed two ways is one key, one value and one item. A writer doesn't need to; the fold does it on every read.
- **A malformed event is skipped whole:** a page that isn't a non-empty title, a path that isn't a non-empty array of strings, a segment that is empty once trimmed, a value or item that isn't a scalar, or a `removed` whose `seen` is empty or has one bad entry.
- **No timestamp in any payload,** and the fold keeps none.
- **No create and no delete by prefix.** A node exists while it or something under it holds something. A removal lists what the writer saw, so what another device added in the meantime survives it.
- **The later write in fold order wins,** for the value and for each item on its own, so two devices writing different paths, or different items on one path, never overwrite each other.
- **A property event spells its page's title** the way `block.created` does, and a page with properties and no blocks is still a page.

The reads take the folded pages, a page title and a path. Each returns a snapshot.

- `get(pages, page, path)`: `{ path, value, items }`, both slots, so no reader has to choose. A path with nothing at it reads as no value and no items.
- `getValue` and `getItems`: one slot each. `getItems` is never undefined, and its last item is the latest added.
- `list(pages, page, scope = [])`: every path at or under `scope` that holds something, sorted by path. `[]` is the page root.
- `children(pages, page, path)`: the next segment of every path under `path`, each once, sorted.
- `path("a/b/c")` and `showPath(["a", "b", "c"])`: a path from text and back, for code and UI. The events always carry the array.

Sorting is by path segment, by codepoint, the same on every device. The order means nothing.

