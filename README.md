<p align="center">
  <img src="logo.svg" alt="Pb Notes logo" width="160" />
</p>

<h1 align="center">Pb Notes</h1>

<p align="center">
  Local-first knowledge sharing and management, safe for many writers.
</p>

## What it is

Pb Notes is a place to think out loud and keep what you learn: daily journal pages, pages that exist as soon as you link to them (`[[Mira]]`, `#Mira`), and under every page, everything that links back to it.

## Status

> [!WARNING]
> Pb Notes is in early development, and the format of a project folder is not settled. A later version may change it, and may not be able to read a folder written by this one. A folder records which version of the format it holds, so a build that meets a newer one refuses to open it and does not misread it. Do not make it the only home for notes you cannot afford to lose.

## Why

- **Your notes are plain files in a folder you pick.** Point Pb Notes at an empty folder and what you write is kept there. It backs up, syncs and moves like any other folder.
- **Safe for many writers.** Leave the folder in Dropbox, iCloud or any other sync tool and write from several machines. Each one writes only its own files, so there is never a conflicted copy, and an edit made elsewhere shows up on screen when it arrives.
- **Nothing is lost if the app's own data is wiped.** The app remembers only which folders you picked. Pick them again and every note is still there.

Text is last-writer-wins per block: if two machines edit the same block before syncing, the later edit is the one kept.

## Development

The repo is an npm workspace: `app/` and the packages under `packages/`. Install once, at the root:

```sh
npm install
cd app
npm start      # electron-forge start
npm test       # node --test, no framework
npm run lint
npm run make   # build distributables
```

`packages/append-only-log/` (`@pbnotes/append-only-log`, the event log) and `packages/files/` (`@pbnotes/files`, hash-named files beside it) are packages the app depends on through the workspace. Neither has dependencies of its own; `npm test` in either folder runs its tests.

The reasoning behind the design is in [app/docs/](app/docs/), starting with [design.md](app/docs/design.md).
