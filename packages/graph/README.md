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

To write, hand `addBlock`, `editBlock`, `deleteBlock`, `deleteBlocks`, `indentBlock`, `indentBlocks`, `outdentBlock`, `outdentBlocks`, `pasteBlocks`, `moveBlock` or `moveBlocks` a `GraphView`: the state you hold, and a `dispatch(v, type, payload)` wired to your own log. They run the same checks the app runs before they write anything.

Each of those writes one event (`deleteBlocks`, `indentBlocks`, `outdentBlocks` and `moveBlocks` write a `batch` when there is more than one block, so they are one undo step; `moveBlocks` lands the top-most blocks together, the first at the place and each next one directly beneath the one before; the last two move each block in turn, on the graph as the one before left it, and write nothing when any of them cannot move; `pasteBlocks` writes copied blocks as new ones, with the caller's ids, as one `batch`, except that a block carrying the id it was cut with (`was`, #246) keeps that id when the graph does not hold it, and a cut pasted `into` an empty block goes after it, takes its children and deletes it, since the first block keeps its own id; and `pasted` builds those events for whoever draws them ahead), and each event has a pure builder: `blockCreated`, `blockEdited`, `blockDeleted`, `blockIndented`, `blockOutdented` and `blockMoved`. A builder returns `{ v, type, payload }` with `v` from `HANDLES`, so a writer that holds no fold can still write a valid event, but it skips the checks.

Page properties have commands too, `setProperty`, `removeProperty` and `renameProperty`, and builders, `propertySet` and `propertyRemoved`.

Page tags have `addTag` and `removeTag`, with builders `tagAdded` and `tagRemoved`. Aliases have builders, `aliasAdded` and `aliasRemoved`, and no commands yet. A page's icon has `setIcon` and `removeIcon`, with builders `iconSet` and `iconRemoved`.

A page is deleted with `deletePage`, whose builder is `pageDeleted`.

Several events that must land together go in one `batch` (below), built from the other builders' results.

Undo is `remember`, `holds` and `invert` (below): a step remembered as what takes it back, whether it can still be taken back, and the events alone.

A view that draws its writes before they are recorded folds them with `predict` for blocks, `predictProperties` for a page's properties, `predictTags` for its tags and `predictIcon` for its icon. Each passes over events that are not its own, and reads a batch as the events it holds, so a view can hand all of them everything it has in flight.

The queries (`getPage`, `getPages`, `getDays`, `getReferences`, `getPreviews`, `getProperties`, `getTags`, `getTaggedBy`, `getIcon`, `getAliases`, `getAliasOf`, `getRenamed`, `resolve`, `getDeletions`, `getRefsTo`, `hasContent`, `searchPages`, `searchNames`, `listPages` and `locateBlock`) take the folded graph alone, since they never write. The ones that take a page's title resolve it first (see "What a name opens"), so `getPage(graph, "JS")` is the page `JS` opens.

## What it does not depend on

- **The log.** The fold takes `{ type, v, payload }` and the commands write through `dispatch`. This package does not import `@pbnotes/ledger`, so events can come from anywhere.
- **Node.** There are no `node:` imports. The app's renderer bundles this package, and it runs under plain `node --test`.

## What the fold holds

The graph `graphFold` folds is plain data: it survives a structured clone, and a title or id of `__proto__` is an ordinary key (#62). It is never changed once handed back, so the ledger can keep earlier graphs to fold a late event from, and undo can read the graph before a step.

- **Blocks are flat** (#276). A forest of block ids grouped by page, each block a row (its page and its parent) and each block's children a list, with every block's text beside it by id. A page is read as a tree (`getPage`, `blocksOn`) when something asks for it, and the tree is built from those rows each time.
- **Every map and set in it is immutable, all the way down** (`immutable/`, #276, #371): a write hands back a new one that shares all but one path of the old one. That holds inside a page's row too: its properties are a map, its tags and aliases are sets. So an event costs the rows it touches, not a copy of the page or the graph it is in, and folding a log costs time in step with its length. Maps and sets are unordered (hash order), so a reader that lists them sorts. The one copy left is a block's list of siblings, which a placement or removal copies whole.
- **The tree shape stays the one the app reads.** `Block` and `Page`, and the walks over a page as a tree (`locate`, `beside`, `without`, `indented`, `outdented`, `lastLeaf`), are what the renderer draws and a paste is built from. The fold doesn't use them.
- **A write that changes nothing hands back the same graph,** and so is not an edit to the page (`getEdited`) or a step for undo. That includes an edit to the text a block already has, which is a repeat.

## The event names are a contract

Every event type is `NAMESPACE` followed by a name, for example `github.com/shovon/pbnotes#block.created`. `HANDLES` gives the payload `v` that this build reads and writes for each one.

- **A name and a `v` never get a new meaning.** Once a log holds an event, it stays on disk forever, and every reader of that folder will see it. A payload that changes shape gets a new `v`, and a new kind of event gets a new name.
- **The namespace is an identifier, not a link.** Do not change its bytes, even if the repository moves.
- **`graphFold` is the gate.** It skips a type that is not in `HANDLES` and a `v` higher than `HANDLES` gives, so an older reader passes over what it cannot read and does not fold it wrongly. Do not call `reduce` on events from a log without the gate in front of it.
- **One test pins every name and its `v`** ("the event names and their v are exactly these", in `graph.test.ts`). Changing either fails it, which is the point: it should only change on purpose.

## Where the events are

Every event is one module in its subject's folder under `src/` (`blocks/`, `pages/`, `properties/`, `tags/`, `aliases/`, `icons/`), one folder per event: its name, its `v`, how its payload is read, its fold, its builder and its undo, together. Beside the events in that folder are what they share (the subject's state and the helpers that change it), its `slice.ts`, which lists its events, and its commands and queries. `HANDLES`, `UNDO`, the fold and the predictions are built from those lists.

[`src/event/README.md`](src/event/README.md) maps the folders, says what an event module holds, and how to add, change or remove an event.

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

## A page's icon is a contract

A page can have one icon, shown beside its title (#322). To the graph it is an opaque string: an emoji, an `image:<hash>`, or anything a later build learns to draw. What it means is up to whoever draws it.

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `icon.set` | 1 | `{ page, icon }` | `page`'s icon is now `icon`. |
| `icon.removed` | 1 | `{ page }` | `page` has no icon. |

- **An icon is not a property.** A property key is a page, so an `icon` key would name an "icon" page and show in every properties table.
- **The graph never reads the string.** No check that it is an emoji or one character. `""` is an icon, not an absence; removing is its own event. **A reader that can't draw a value shows no icon,** rather than an error or the raw string.
- **The later event wins,** in fold order, the same on every machine, as with block text. Removing an icon the page lacks changes nothing.
- **An icon names a page; it never creates one,** as with tags. A page with an icon has something on it: `hasContent` counts it, it is listed and searched, `resolve` rule 1 counts it as a page of its own, a page delete removes it (and its undo sets it back), a rename moves it, and setting or removing one is an edit to the page.
- **Malformed is skipped whole:** a payload that is not an object, a `page` that is not a string or is blank once trimmed, or an `icon` that is not a string. Any other field is ignored.
- **`getIcon(graph, page)`** is the icon of the page `page` opens, or undefined. **The commands** refuse a blank page and write nothing for a change that changes nothing: `setIcon(view, page, icon)` for the icon the page has, `removeIcon(view, page)` for a page with none. **`predictIcon(icon, page, events)`** folds writes still in flight over the icon a page was sent.

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

1. **A name with a page of its own opens itself:** blocks, properties, tags or an icon on it. Nothing is ever hidden behind another name.
2. **A date name opens its day.**
3. **A `YYYY-MM-DD` opens itself.** No alias takes a day over, in either form, but a day can have aliases.
4. **A name with aliases of its own opens itself.** One hop only, so nothing chains and nothing loops.
5. **An alias opens the page that claims it.** When two pages claim one, the one whose `canonicalize`d title sorts first wins, the same on every machine. A page claiming it that is a date name, with nothing on it, is its day.
6. Otherwise, the name opens itself.

- **The reads resolve first.** `getPage`, `getProperties`, `getTags` and `getIcon` read the page a name opens. `getReferences` and `getTaggedBy` match every name that opens it: its title, its date names if it is a day, and its aliases in effect. A link keeps the spelling it was written with.
- **`getAliases(graph, page)`** lists the aliases in effect, not the built-in names, and **`getAliasOf(graph, alias)`** the page an alias in effect opens.
- **`searchNames(graph, query)`** offers each name with the page it `opens`; `searchPages` is the titles alone. Beside the titles it always offered, it offers aliases, and for each day any offered name opens, the day's title and its date names. A day nothing names isn't offered, since the days can't be listed without end. A name a rename left behind isn't offered either (below).
- **`listPages`** lists each page once, under its title. A name that opens another page isn't a row, and its links and tags count for the page it opens, a block or a tagging page once however many of the page's names it uses.

## Deleting a page is a contract

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `page.deleted` | 1 | `{ page }` | The user was done with `page`: its blocks, its properties, its tags, its aliases and its icon. Tags on other pages that point to it stay, as links to it do. |

- **One event for the whole page.** No `block.deleted` per block and no `property.removed` per key, so a crash or a sync still arriving can never leave a page half deleted.
- **It applies to the page as it stands at that point in fold order.** A block or property that sorts before it goes with it, however late it arrived. One that sorts after it is a later fact and stands. An edit that sorts after it, to a block it removed, changes nothing, like any edit to a block the fold does not have.
- **Nothing leaves the disk.** Every block and property the page held stays in the log.
- **Whether the page still exists is not stored.** A page that only a link names exists while the link does, so a page another page links to stays in search, empty, under the spelling it had, until the last link goes. Links on the deleted page itself go with it.
- **Each delete is counted per page** (`getDeletions`), so a reader can tell that a page was deleted from a page that merely went empty.
- **Malformed is skipped whole:** a payload that is not an object, or a `page` that is not a string or is blank once trimmed.
- **`deletePage(view, page)`** writes nothing for a page with nothing on it (`hasContent`): the delete would change nothing. **`getRefsTo(graph, page)`** counts the blocks on other pages that hold a `((id))` to a block on it: what a delete would leave showing as missing. What links to it by title is `getReferences`.

## Renaming a page is a contract

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `page.renamed` | 1 | `{ from, to }` | The page `from` is now called `to`. |

A reader that folds this event has to do all of what follows to show the same graph. One that understands aliases but not the rewrite still opens the right page, with the old text.

- **One event, and the fold does all of it.** No `block.edited` per linking block: an edit replaces a block's whole text, and one that sorted after a concurrent edit on another device would wipe that edit out. The rewrite applies to whatever text is there at its place in fold order, so a block written offline that sorts before the rename is rewritten when it arrives.
- **Titles are filed by `keyFor`:** the day a date name means, or the title's `canonicalize`d key. Renaming to `Nov 6th, 2026` makes the page that day.
- **When the keys differ, the page moves:** its blocks (in their order and nesting, `regroup`), properties, tags, aliases, icon and last-edited time go to `to`'s key, and `to` becomes its spelling.
- **The old title becomes an alias,** along with the aliases the page had; a page never answers to its own title, so renaming onto one of its aliases drops it. **A day leaves no alias,** since nothing takes a `YYYY-MM-DD` over (`resolve` rule 3): a write on the day afterwards stays on the day.
- **What pointed at the old title points at `to`:** every link in every block (below), every tag on any page, and every property key on any page, unless that page already has the key `to`, when both are left as they are. For a day, every link, tag or key by any of its date names.
- **Links are rewritten where they are written,** read with the parser the renderer reads with (`relink`): one in code, math, a URL or an alias's label is left alone, as is everything else in the text. `[[x]]`, `#[[x]]` and `[label]([[x]])` keep their form and label. A bare `#x` stays bare unless `to` can't be a bare tag, when it becomes `#[[to]]`.
- **A write on the old title goes to the page it became** while that page still answers to it (`redirect`): any event with a `page` field (blocks, properties, tags, aliases, icons, a page delete) that sorts after the rename. A device that wrote offline before seeing the rename lands where it meant to, rather than giving the old title content of its own, which would take the name back (rule 1). Removing the alias ends it.
- **A page with nothing on it is renamed like any other.** Every page already exists, and its links, tags and keys are what there is to rename: they follow, and the old title becomes an alias.
- **A rename that can't move the page does nothing:** `to` has content of its own (`hasContent`), `to` is a name a rename sends to another page, or `from` has nothing on it and either another page claims it as an alias or nothing names it at all. The alias case is what holds two renames of one page: the first leaves `from` empty and claimed by the page it became, so the first in fold order wins. A page nothing is on or names has nothing to rename. Nothing is ever merged without being asked.
- **When the keys are the same, only the spelling changes** (#89): the page shows as `to` from then on, even though `titles` otherwise keeps the first spelling seen. Nothing moves and no text changes. A day's spelling never changes.
- **The names a rename left behind aren't offered by `searchNames`.** They still open the page; they are a safety net, and a renamed typo shouldn't keep being offered. `getAliases` still lists them.
- **Malformed is skipped whole:** a payload that is not an object, or a `from` or `to` that is not a string or is blank once trimmed.
- **`renamePage(view, from, to)`** renames the page `from` opens, and refuses, writing nothing, a `to` with content of its own, a `to` that opens another page, and a `to` holding `[[`, `]]` or a line break. A rename to the spelling the page has, or of a page nothing is on or names, writes nothing.
- **Undone by renaming back,** with the alias that leaves on the old page removed, as one batch. Each rewritten link comes back naming the page as it is spelled, so `[[bridal falls]]` comes back `[[Bridal Falls]]`, and a bare tag that took brackets keeps them. It stops once anything on the page has changed since, or anything has been written under the old title.

## A block id is written once

A block id names one block in the whole graph. Two `block.created` events for one id can still reach a folder: two writers each pasting the same cut, or each undoing the same delete, before they sync (#273).

- **The first create in fold order stands.** A later one for an id the graph holds now changes nothing: not the text, not the place. Fold order is the same on every machine, so every machine shows the same block in the same place.
- **"Holds now" means in the graph at that point,** not ever: an id that was deleted can be created again, which is what undoing a delete and pasting a cut rely on.
- **A create under a parent on another page follows the parent there.** The parent moved after the writer last saw it, or a skipped create of it put it elsewhere, and the block was written under it either way. Before #273 such a block went to the end of the page its event named.
- **Undo of a create that lost stops,** as for any step someone else changed, unless the winning create put the block in the same place with the same text and children: then the two can't be told apart, and undo removes it.

## Moving a block is a contract

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `block.moved` | 1 | `{ id, page, after?, parent?, first? }` | The block, with its subtree, now sits at this place on `page` (#252). |

- **The place means what it means on `block.created`:** after the sibling `after` (which, with `parent`, has to be one of `parent`'s children), first under `parent`, or first on the page with `first`. With none of them, the block goes at the end of the page. `after` and `parent` win over `first`.
- **`page` is always written,** even for a move on the same page, so the payload says where the block ends up without reading the graph. A page with no blocks yet gets this one, spelled as written.
- **A move that cannot be followed is ignored, never guessed at.** The block stays where it was when the graph lacks it, when it is already there, when the place is inside its own subtree (two writers each moving one block under the other before they sync, #62), or when the target page lacks the `after` or `parent`, or `after` is not `parent`'s child. Unlike `block.created`, which falls back so a block is never lost, a move can't lose a block, so it leaves it where its owner last saw it.
- **`moveBlock(view, id, title, place)`** refuses what the fold would ignore, and writes nothing for a block already there. `moveBlocks(view, ids, title, place)` (#269) is several blocks moved as one: a `batch` of moves, each placed after the one before, at its depth, refusing a place inside any of their subtrees.
- **An older build** does not know the type, so the block stays where it was for it, and every later edit to it still lands, since an edit finds a block by id.

## Batches are a contract

Some things a user does take more than one event. Each event is its own record, so a crash or a sync that stops between two of them would leave the folder halfway through. A batch is several events written as one record, folded all together or not at all (#225).

| Type | `v` | Payload | Meaning |
|---|---|---|---|
| `batch` | 1 | `{ events: [{ type, v, payload }, …] }` | These events, in this order, as one. |

- **Folded in order, all or none, at the batch's place.** Each event goes through the same gate and slices as it would alone, one after another, with the batch's `at`. Nothing folds between them.
- **One event this build cannot read skips the whole batch:** a type not in `HANDLES`, a `v` higher than `HANDLES` gives, or a payload its slice would skip as malformed. The state comes back as the same object. Folding the rest would be the half-done state a batch exists to prevent.
- **Malformed is skipped whole:** a payload that is not an object, `events` that is not a list or is empty, an entry that is not `{ type: string, v: number, payload }`, or a batch inside the batch. Fields beyond these are ignored.
- **An event in a batch means what it means alone.** An edit to a block the fold lacks changes nothing, in a batch or not.
- **Why not in the ledger.** A batch could be one record holding several envelopes, below every fold. That changes the record format, so every older build would have to refuse the folder. As a graph event nothing on disk changes: an older build skips `batch` as a type it does not know, and so loses the whole action, never half of it.
- **`batch(events)`** takes builder results and returns `{ v, type, payload }`. It throws for no events or a batch among them, which is a bug in the caller. `renameProperty` writes its `property.set` and `property.removed` as one batch.

## Undoing

A step is what one command wrote: its events, on the graph before it. Nothing here keeps a history; that is the caller's (#224).

**`remember(before, events)`** is how a caller keeps a step (#242). It is called once, when the step is written, and gives the step's `inverse` (what `invert` gives) and, for each thing the step touched, a reading and the value it gave on the graph right after. It keeps no graph, so `before` and the graph after can be let go once it returns, and what a step costs does not grow with the project.

- **`invert(before, events)`** gives the events that undo `events`, to be written as one `batch`. They are plain events that any build reads, never an "undo" event: the log only grows, and what was undone stays on disk.
- **The last event is undone first,** each against the graph as it stood just before it. A batch is the events it holds.
- **What changed nothing has no inverse:** an edit to a block that isn't there, a tag a page already has. `[]` means there is nothing to undo.
- **`undefined` means the step cannot be undone.** One event in it that cannot be undone makes the whole step `undefined`, never half undone. No event says so today, since `block.moved` (#252) can put any block back where it was. The rule stays for an event that cannot be undone.
- **A deleted block comes back with its subtree,** with the same ids and text, so a `((id))` to any of them resolves again: a page's first block with `first`, a first child with `parent`, the rest with `after`. A deleted page comes back the same way, then its properties, tags and aliases, spelled as they were.
- **An indent under the sibling above is undone by an outdent after it,** and an outdent by an indent under the old parent, then an outdent for each sibling it took along, last first. An indent anywhere else, which only another writer's log holds, is undone by a `block.moved` back.
- **A move is undone by a move back:** to its page, under its parent, after the sibling that was above it (or first).
- **Titles and delete counts are not undone.** A spelling, once seen, stays, and `getDeletions` still counts a delete that was undone.

**`holds(now, remembered)`** is whether a step can still be undone: every reading gives in `now` what it gave right after the step. False means someone else changed it since, and undoing it would undo their work too. Only what the step touched is read:

| The step | Compared |
|---|---|
| Created a block | The block's text, its whole subtree, and where it sits |
| Edited a block | Its text, so a block moved since still holds |
| Indented, outdented or moved a block | Where it sits (page, parent, the siblings either side), and where each sibling an outdent took along sits. A move still holds with a new text or new children |
| Deleted a block | That none of the deleted ids exist again |
| Deleted a page | That none of its blocks' ids exist again. A page that gained new blocks since still holds |
| Set or removed a property | The page's value for that key |
| Added or removed a tag or an alias | Whether the page has it |

### Where an event's undo lives

In the event's own module, under `src/events/`: `inverse`, the events that undo it from the graph just before it, and `touched`, the readings `holds` compares for it. An event that cannot be undone says `undo: "cannot"`, never nothing.

**A reading** is a function from a graph to a plain value (a string, a number, a boolean or `undefined`), compared with `===`. A remembered step holds on to its readings, so a reading keeps ids, a title or a key, never the graph it was made from: one that kept the graph would keep it alive for as long as the step is remembered. Each event makes its readings with `same(…)`.

`UNDO` in `graph.ts` is every subject's undo table put together, keyed on every type in `HANDLES` but `batch`, so an event type with no entry stops the build. `undo/` holds only the walk, which knows no event: it is handed the fold and the table.
