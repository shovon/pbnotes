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

## Install

macOS only for now. Download the `.dmg` from the [latest release](https://github.com/shovon/pbnotes/releases/latest), open it and drag Pb Notes to Applications.

The app is not yet signed with an Apple Developer ID, so macOS will not open it the first time. To allow it, once:

1. Open Pb Notes. macOS says it could not verify the app. Click **Done**.
2. Open System Settings → Privacy & Security, scroll down to the message about Pb Notes and click **Open Anyway**.
3. Open Pb Notes again and confirm.

If macOS instead says Pb Notes "is damaged and can't be opened", run this in Terminal, then open it again:

```sh
xattr -dr com.apple.quarantine "/Applications/Pb Notes.app"
```

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

`packages/ledger/` (`@pbnotes/ledger`, the event log), `packages/files/` (`@pbnotes/files`, hash-named files beside it) and `packages/pages/` (`@pbnotes/pages`, what the events mean, for the app and for any other program that reads a folder) are packages the app depends on through the workspace. The first two have no dependencies of their own, and `pages` depends only on the Markdown parser it reads links with. `npm test` in any of these folders runs its tests.

What stays the same whatever the product becomes is in [DNA.md](DNA.md). The folder format is [packages/ledger/multi-writer.md](packages/ledger/multi-writer.md).
