# Logseq import

`@pbnotes/logseq` reads a Logseq file-based ("Markdown mode") graph folder and writes it into a pbnotes project: pages, journal days, the block tree, page properties, page tags, aliases, block refs and images (#204). This is the library; the `pbnotes import-logseq` command (#220) and the app's menu item are thin entry points over it.

```ts
import { randomUUID } from "node:crypto";
import { openWriter } from "@pbnotes/ledger";
import { diskFolder, importGraph, storeBeside } from "@pbnotes/logseq";

await using writer = await openWriter(project, "pbnotes-import");
const report = await importGraph(diskFolder(graph), writer, {
  newId: randomUUID,
  store: storeBeside(writer.directory),
});
```

`importGraph` writes into whatever writer it is handed. Refusing a project that already holds events is the caller's rule.

## Layers

Pure in the middle, I/O only at the edge:

| Slice | What it does |
|---|---|
| `parse/` | One file's text into page properties and a tree of blocks. |
| `dates/` | Days in date-fns patterns (`yyyy_MM_dd`, `EEE do, MMM yyyy`), both ways. Knows nothing of Logseq. |
| `config/` | The three `config.edn` keys the import reads. |
| `titles/` | A page's title from its filename, and a journal file's day. |
| `lists/` | The names in a `tags::` or `alias::` value. |
| `images/` | Links into `assets/`, found and rewritten. |
| `plan/` | Every file and asset into ordered events, images to store, and a report. Deterministic apart from the ids it is handed. |
| `import/` | Reads the folder through a `Folder` port, stores images, posts events. `disk.ts` holds the production adapters. |

## What comes across, and how

- `journals/*.md` are journal days, titled `YYYY-MM-DD` from `:journal/file-name-format`. `pages/*.md` are pages, titled by `title::` or by the filename decoded under `:file/name-format`. Files whose titles are one page are merged, in path order.
- One `block.created` per block, in document order. A nested block names its `parent` and the sibling before it as `after`, so the tree needs no `block.indented`.
- `id::` becomes the block's id, so `((uuid))` refs keep working. `collapsed::` and `:LOGBOOK:` drawers are dropped. Every other line, block properties, task markers and macros included, stays as text.
- Page properties become `property.set`, except `title::` (the title), `tags::` (`tag.added`) and `alias::` (`alias.added`).
- Journal date links in Logseq's default title format need nothing written: every day answers to them (#221). Under a custom `:journal/page-title-format`, each day gets its names in it as aliases.
- Embedded images under `assets/` are stored as the app stores a pasted one and relinked to `images/<sha256>.<ext>`.

Everything skipped, dropped, merged or left as written is in the returned `Report`, as data for the caller to word.

## Not covered

Org-mode files, whiteboards, DB-version (SQLite) graphs, importing into a project that has notes, and re-importing. Every event is stamped with the time of the import, not when it was written in Logseq.
