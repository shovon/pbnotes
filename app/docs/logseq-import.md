# Importing a Logseq markdown graph

Not built yet. This records what an importer for Logseq's file-based ("markdown mode") graphs would take, so the question can be picked up later without redoing the research.

## Structure is the easy part

pbnotes block text already uses Logseq's inline syntax: `[[Mira]]`, `#Mira`, `#[[Mira]]`, and Markdown. So an importer only has to recover structure (which page each block is on, and the tree) and copy each block's text across verbatim. It does not need Logseq's semantic interpretation of the graph.

The outline format is small enough to split by hand:

- A line whose left-trimmed text starts with `- ` (or is a bare `-`) starts a block. Its depth is its indentation; Logseq writes tabs by default, but some files use spaces.
- Lines after it, indented to the block's content column, continue that block.
- Inside a fenced code block, `- ` lines are content, not new blocks. This is the one real parsing trap, and the reason the splitter needs a test.

## Mapping onto pbnotes events

- `journals/2024_01_31.md` becomes the page `2024-01-31`, which already matches `DATE_PATTERN` in `src/shared/pages.ts`.
- `pages/Foo.md` takes its title from a `title::` property if the file has one. Otherwise it comes from the filename, with `%2F` or `___` decoded back to `/` depending on the graph's `:file/name-format`.
- Walk the blocks in document order. Emit `block.created` with no `after` (end of page), then `block.indented { parent }` for any nested block. Indenting makes a block its parent's last child, so document order produces the right tree without computing `after`.
- The importer is an ordinary writer on this device's log, so the one-writer-per-file rule holds.

## Decisions to make first

None of these is hard to parse. Each is a product decision about a Logseq feature pbnotes does not have yet.

- **Property lines** (`key:: value`, including page properties on a file's first block): pbnotes has no properties. Each one is dropped, kept as plain text, or kept somewhere for later.
- **Block refs** (`((uuid))`): these only keep working if the Logseq `id::` becomes the pbnotes block id. Otherwise they are left as dead text.
- **Collapsed state** (`collapsed:: true`): this waits on the collapsed-subtree decision.
- **Assets** (`../assets/…`): the links break unless the files are copied alongside the notes.
- **Re-running the import**: the log is never rewritten, so a second run duplicates every block unless ids are deterministic, for example derived from the file path plus the block's position.

## Logseq's own tooling, if hand-splitting falls short

- **`mldoc`** ([logseq/mldoc](https://github.com/logseq/mldoc), npm `mldoc`): Logseq's own parser for its Markdown and Org dialects, compiled from OCaml to JS, returning a JSON AST (`Mldoc.parseJson`). It reports source positions, so raw block text can still be sliced from the original file. It is the fallback, at the cost of a large bundle.
- **`@logseq/graph-parser`** (`deps/graph-parser` in the main Logseq repo): ClojureScript. It turns a whole graph folder into a DataScript database, resolving aliases, namespaces and property types. It is more than pbnotes needs, and it brings in a ClojureScript toolchain.
- **`@logseq/nbb-logseq`**: ClojureScript scripting on Node with Logseq's libraries preloaded. It is how you would run `graph-parser` without building the Logseq app.
- **File graph → DB graph importer**: the DB version of Logseq converts markdown-mode graphs into its new format. Its source is the best written record of Logseq's edge cases.
- **Plugin API (`@logseq/libs`) and the desktop app's HTTP API server**: these return already-parsed blocks, but only while Logseq is running with the graph open.

These package names and entry points come from memory and were not checked live; confirm them against the repos before depending on one.
