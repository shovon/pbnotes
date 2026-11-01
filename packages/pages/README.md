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

Page properties have commands too, `setProperty`, `removeProperty` and `renameProperty`, and builders, `propertySet` and `propertyRemoved`.

A view that draws its writes before they are recorded folds them with `predict` for blocks and `predictProperties` for a page's properties. Each passes over events that are not its own, so a view can hand both everything it has in flight.

The queries (`getPage`, `getPages`, `getReferences`, `getPreviews`, `getProperties`, `searchPages` and `locateBlock`) take the folded pages alone, since they never write.

## What it does not depend on

- **The log.** The fold takes `{ type, v, payload }` and the commands write through `dispatch`. This package does not import `@pbnotes/ledger`, so events can come from anywhere.
- **Node.** There are no `node:` imports. The app's renderer bundles this package, and it runs under plain `node --test`.

## The event names are a contract

Every event type is `NAMESPACE` followed by a name, for example `github.com/shovon/pbnotes#block.created`. `HANDLES` gives the payload `v` that this build reads and writes for each one.

- **A name and a `v` never get a new meaning.** Once a log holds an event, it stays on disk forever, and every reader of that folder will see it. A payload that changes shape gets a new `v`, and a new kind of event gets a new name.
- **The namespace is an identifier, not a link.** Do not change its bytes, even if the repository moves.
- **`pagesFold` is the gate.** It skips a type that is not in `HANDLES` and a `v` higher than `HANDLES` gives, so an older reader passes over what it cannot read and does not fold it wrongly. Do not call `reduce` on events from a log without the gate in front of it.

## Page titles are a contract

A page has no id. Two titles are the same page when `canonicalize` gives the same string for both, and that is exactly this:

```ts
title.replace(/[​﻿]/g, "").trim().toLowerCase().normalize("NFC")
```

- **The expression is the specification,** not a description of it. Another reader has to produce the same bytes for every title, or it splits or merges pages the app shows as one. Call `canonicalize` rather than copying it.
- **What it does, in order:** drops zero-width spaces and byte-order marks (but keeps the zero-width joiner and non-joiner, which emoji and Persian need), trims, lowercases without regard to locale, then puts the result in NFC. NFC goes last because lowercasing can undo it. NFKC is deliberately not used, so `ﬁ` and `x²` stay as they are.
- **It is computed on every read and never written down.** The log keeps every title as it was typed, and a page shows the first spelling the fold saw.
- **Changing it regroups pages in every existing folder** the next time it is opened. Change it rarely, on purpose, and say so in the release.

## Page properties are a contract

A page has properties: each a key and a string value. A key is a page title, compared through `canonicalize` like any other, so setting `Status` on `Foo` names two pages, `Foo` and `Status`.

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `property.set` | 1 | `{ page, key, value }` | `page`'s `key` is now `value`. |
| `property.removed` | 1 | `{ page, key }` | `page` no longer has `key`. |

- **A property names a page; it never creates one.** Both events give `page` and `key` a spelling if they have none yet, the first spelling the fold saw, as blocks and links do. A page that only properties name, as the page they are on or as a key, is a page while one of them stands, and stops being one when the last goes, as a page that only a link names does when the link goes. To keep a page, write on it or link to it.
- **A value is a plain string.** It is not read for links, so `[[x]]` in a value names nothing. `""` is a value, not an absence; removing is its own event.
- **The later event wins,** in fold order, the same on every machine, as with block text. Removing a key the page does not have changes nothing.
- **Malformed is skipped whole:** a payload that is not an object, a `page`, `key` or `value` that is not a string, or a `page` or `key` that is blank once trimmed. Any other field in a payload is ignored, not an error.
- **`getProperties(pages, page)`** lists a page's properties as `{ key, value }`, each key in the spelling it shows, ordered by `canonicalize(key)`.
- **The commands** refuse what the fold would skip (a blank page or key) and write nothing for a change that changes nothing: setting the value a key has, or removing a key the page lacks. `renameProperty(view, page, from, to)` writes a `set` of `to` with `from`'s value, then a `removed` of `from`, so a stop between them leaves both keys and never neither. It refuses a `from` the page lacks and a `to` it already has, and writes nothing for a `to` that is `from` once canonicalized: a key's spelling is its page's, so a rename cannot change it.
