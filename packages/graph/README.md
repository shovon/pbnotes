# Graph

What the events in a pbnotes folder mean. The app folds them with this, and any other program that reads or writes the folder should do the same. A program that copies the fold drifts from the app, and when two folds disagree about one folder, one of them is wrong about the user's notes.

```ts
import { openOrCreate } from '@pbnotes/ledger';
import { getPages, getReferences, graphFold } from '@pbnotes/graph';

const ledger = await openOrCreate(folder);
for await (const graph of ledger.onEvent(graphFold.initial, graphFold.reduce)) {
  // the same graph the app shows
}
```

To write, hand `addBlock`, `editBlock`, `deleteBlock`, `indentBlock` or `outdentBlock` a `GraphView`: the state you hold, and a `dispatch(v, type, payload)` wired to your own log. They run the same checks the app runs before they write anything.

Each of those writes one event, and each event has a pure builder: `blockCreated`, `blockEdited`, `blockDeleted`, `blockIndented` and `blockOutdented`. A builder returns `{ v, type, payload }` with `v` from `HANDLES`, so a writer that holds no fold can still write a valid event, but it skips the checks.

Page properties have commands too, `setProperty`, `removeProperty` and `renameProperty`, and builders, `propertySet` and `propertyRemoved`.

Page tags have `addTag` and `removeTag`, with builders `tagAdded` and `tagRemoved`. Aliases have builders, `aliasAdded` and `aliasRemoved`, and no commands yet.

A page is deleted with `deletePage`, whose builder is `pageDeleted`.

A view that draws its writes before they are recorded folds them with `predict` for blocks and `predictProperties` for a page's properties. Each passes over events that are not its own, so a view can hand both everything it has in flight.

The queries (`getPage`, `getPages`, `getReferences`, `getPreviews`, `getProperties`, `getTags`, `getTaggedBy`, `getAliases`, `getAliasOf`, `resolve`, `getDeletions`, `getRefsTo`, `hasContent`, `searchPages`, `searchNames`, `listPages` and `locateBlock`) take the folded graph alone, since they never write. The ones that take a page's title resolve it first (see "What a name opens"), so `getPage(graph, "JS")` is the page `JS` opens.

## What it does not depend on

- **The log.** The fold takes `{ type, v, payload }` and the commands write through `dispatch`. This package does not import `@pbnotes/ledger`, so events can come from anywhere.
- **Node.** There are no `node:` imports. The app's renderer bundles this package, and it runs under plain `node --test`.

## The event names are a contract

Every event type is `NAMESPACE` followed by a name, for example `github.com/shovon/pbnotes#block.created`. `HANDLES` gives the payload `v` that this build reads and writes for each one.

- **A name and a `v` never get a new meaning.** Once a log holds an event, it stays on disk forever, and every reader of that folder will see it. A payload that changes shape gets a new `v`, and a new kind of event gets a new name.
- **The namespace is an identifier, not a link.** Do not change its bytes, even if the repository moves.
- **`graphFold` is the gate.** It skips a type that is not in `HANDLES` and a `v` higher than `HANDLES` gives, so an older reader passes over what it cannot read and does not fold it wrongly. Do not call `reduce` on events from a log without the gate in front of it.

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
- **`getProperties(graph, page)`** lists a page's properties as `{ key, value }`, each key in the spelling it shows, ordered by `canonicalize(key)`.
- **The commands** refuse what the fold would skip (a blank page or key) and write nothing for a change that changes nothing: setting the value a key has, or removing a key the page lacks. `renameProperty(view, page, from, to)` writes a `set` of `to` with `from`'s value, then a `removed` of `from`, so a stop between them leaves both keys and never neither. It refuses a `from` the page lacks and a `to` it already has, and writes nothing for a `to` that is `from` once canonicalized: a key's spelling is its page's, so a rename cannot change it.

## Page tags are a contract

A page has tags: other pages it points to, and nothing else. A tag has no value, no type and no order. A tag is a page title, compared through `canonicalize` like any other, so tagging `Foo` with `Work` names two pages, `Foo` and `Work`.

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `tag.added` | 1 | `{ page, tag }` | `page` now points to `tag`. |
| `tag.removed` | 1 | `{ page, tag }` | `page` no longer points to `tag`. |

- **A tag names a page; it never creates one.** Both events give `page` and `tag` a spelling if they have none yet, the first spelling the fold saw. A page that only tags name, as the page they are on or as a tag, is a page while one of them stands, and stops being one when the last goes, as with properties and links.
- **A page holds a tag once.** Adding a tag it has, or removing one it lacks, changes nothing. A page may tag itself.
- **The later event wins** per `(page, tag)`, in fold order, the same on every machine.
- **Malformed is skipped whole:** a payload that is not an object, or a `page` or `tag` that is not a string or is blank once trimmed. Any other field in a payload is ignored, not an error.
- **`getTags(graph, page)`** lists the pages `page` points to, and **`getTaggedBy(graph, tag)`** the pages that point to `tag`, each in the spelling it shows, ordered by `canonicalize`. **`listPages`** counts the pages tagging each page as `taggedBy`, apart from `references`, which tags never change.
- **The commands** refuse what the fold would skip (a blank page or tag) and write nothing for a change that changes nothing: `addTag(view, page, tag)` for a tag the page has, `removeTag(view, page, tag)` for one it lacks. **`predictTags(tags, page, events)`** folds writes still in flight over the tags a page was sent, as `predictProperties` does.

## Page aliases are a contract

A page can answer to other names. An alias is a page title, compared through `canonicalize` like any other, so giving `JavaScript` the alias `JS` names two pages, `JavaScript` and `JS`.

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `alias.added` | 1 | `{ page, alias }` | `page` answers to `alias`. |
| `alias.removed` | 1 | `{ page, alias }` | `page` no longer answers to `alias`. |

- **The fold only records them.** Which page a name opens is read, never stored (below), so removing an alias undoes everything it did at once. No block is ever filed under any title but the one it was created under.
- **A page holds an alias once,** with no value and no order. Adding one it has, or removing one it lacks, changes nothing. **The later event wins** per `(page, alias)`, in fold order.
- **An alias names a page; it never creates one,** as with tags. A page that has aliases has something on it: `hasContent` counts them, a page delete removes them, and adding or removing one is an edit to the page.
- **Malformed is skipped whole:** a payload that is not an object, or a `page` or `alias` that is not a string or is blank once trimmed. Any other field is ignored.

## Built-in date names are a contract

A journal day answers to its date in words, with nothing written. A name, once `canonicalize`d, is a date name when it reads as a real day in one of these formats:

| Format | Example |
|---|---|
| `MMM do, yyyy` | `Nov 4th, 2024` |
| `MMMM do, yyyy` | `November 4th, 2024` |

- **English months:** `Jan` … `Dec` (`Sep`, not `Sept`) and `January` … `December`. **English ordinals:** `1st`, `2nd`, `3rd`, `4th`, `11th`, `12th`, `13th`, `21st`, … `31st`; a wrong one (`4st`) is not a date.
- **A real day only.** `Feb 30th, 2024` and `Feb 29th, 2023` are ordinary page titles.
- **No numeric formats,** since `04/05/2024` reads differently in different places.
- **The table is the specification,** as `canonicalize`'s expression is. Names are read, not stored, so adding a format makes links already written in it open their day in every folder. Change it rarely, on purpose, and say so in the release.
- **`dateOf(name)`** gives the `YYYY-MM-DD` a name means, or undefined, and **`namesOf(day)`** a day's names, in the table's order.

## What a name opens

**`resolve(graph, title)`** is the page a name opens, as it shows. The first of these that applies:

1. **A name with a page of its own opens itself:** blocks, properties or tags on it. Nothing is ever hidden behind another name.
2. **A date name opens its day.**
3. **A `YYYY-MM-DD` opens itself.** No alias takes a day over, in either form, but a day can have aliases.
4. **A name with aliases of its own opens itself.** One hop only, so nothing chains and nothing loops.
5. **An alias opens the page that claims it.** When two pages claim one, the one whose `canonicalize`d title sorts first wins, the same on every machine. A page claiming it that is a date name, with nothing on it, is its day.
6. Otherwise, the name opens itself.

- **The reads resolve first.** `getPage`, `getProperties` and `getTags` read the page a name opens. `getReferences` and `getTaggedBy` match every name that opens it: its title, its date names if it is a day, and its aliases in effect. A link keeps the spelling it was written with.
- **`getAliases(graph, page)`** lists the aliases in effect, not the built-in names, and **`getAliasOf(graph, alias)`** the page an alias in effect opens.
- **`searchNames(graph, query)`** offers each name with the page it `opens`; `searchPages` is the titles alone. Beside the titles it always offered, it offers aliases, and for each day any offered name opens, the day's title and its date names. A day nothing names isn't offered, since the days can't be listed without end.
- **`listPages`** lists each page once, under its title. A name that opens another page isn't a row, and its links and tags count for the page it opens, a block or a tagging page once however many of the page's names it uses.

## Deleting a page is a contract

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `page.deleted` | 1 | `{ page }` | The user was done with `page`: its blocks, its properties, its tags and its aliases. Tags on other pages that point to it stay, as links to it do. |

- **One event for the whole page.** No `block.deleted` per block and no `property.removed` per key, so a crash or a sync still arriving can never leave a page half deleted.
- **It applies to the page as it stands at that point in fold order.** A block or property that sorts before it goes with it, however late it arrived. One that sorts after it is a later fact and stands. An edit that sorts after it, to a block it removed, changes nothing, like any edit to a block the fold does not have.
- **Nothing leaves the disk.** Every block and property the page held stays in the log.
- **Whether the page still exists is not stored.** A page that only a link names exists while the link does, so a page another page links to stays in search, empty, under the spelling it had, until the last link goes. Links on the deleted page itself go with it.
- **Each delete is counted per page** (`getDeletions`), so a reader can tell that a page was deleted from a page that merely went empty.
- **Malformed is skipped whole:** a payload that is not an object, or a `page` that is not a string or is blank once trimmed.
- **`deletePage(view, page)`** writes nothing for a page with nothing on it (`hasContent`): the delete would change nothing. **`getRefsTo(graph, page)`** counts the blocks on other pages that hold a `((id))` to a block on it: what a delete would leave showing as missing. What links to it by title is `getReferences`.
