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

Download from the [latest release](https://github.com/shovon/pbnotes/releases/latest). Pb Notes is early: for now it's released only as files on GitHub, not through any app store or package repository, and it doesn't update itself. The app is not signed yet, so macOS and Windows each warn about it the first time it opens; the steps below get past that, once.

### macOS

Download the `.dmg`, open it and drag Pb Notes to Applications.

The app is not yet signed with an Apple Developer ID, so macOS will not open it the first time. To allow it, once:

1. Open Pb Notes. macOS says it could not verify the app. Click **Done**.
2. Open System Settings → Privacy & Security, scroll down to the message about Pb Notes and click **Open Anyway**.
3. Open Pb Notes again and confirm.

If macOS instead says Pb Notes "is damaged and can't be opened", run this in Terminal, then open it again:

```sh
xattr -dr com.apple.quarantine "/Applications/Pb Notes.app"
```

### Windows

Download the installer for your PC:

- **`…-x64-Setup.exe`** for most PCs, with an Intel or AMD processor.
- **`…-arm64-Setup.exe`** for a PC with an ARM processor, such as a Snapdragon.

Not sure which? Settings → System → About shows it under **System type**.

Double-click the installer. It installs Pb Notes for your user only, with no admin rights needed, opens it, and adds it to the Start menu and the desktop.

The app is not yet signed, so the first time Windows shows "Windows protected your PC". Click **More info**, then **Run anyway**.

To uninstall, go to Settings → Apps → Installed apps, find Pb Notes and choose **Uninstall**. Your notes stay where they are: they live in the folders you picked, not in the app.

### Linux

Download the package for your distribution and your PC's processor:

| Distribution | Intel or AMD | ARM |
| --- | --- | --- |
| Debian, Ubuntu, Linux Mint, Pop!_OS | `pbnotes_…_amd64.deb` | `pbnotes_…_arm64.deb` |
| Fedora, RHEL, openSUSE | `pbnotes-…x86_64.rpm` | `pbnotes-…arm64.rpm` |

Not sure which processor? `uname -m` prints `x86_64` for Intel or AMD, and `aarch64` for ARM.

Install it from the folder you downloaded it to. On Debian or Ubuntu:

```sh
sudo apt install ./pbnotes_*.deb
```

On Fedora or RHEL (on openSUSE, `sudo zypper install` instead):

```sh
sudo dnf install ./pbnotes-*.rpm
```

Pb Notes then shows up among your apps. Neither package updates itself yet: to get a new version, download and install it the same way.

To uninstall, run `sudo apt remove pbnotes` or `sudo dnf remove pbnotes`. Your notes stay where they are: they live in the folders you picked, not in the app.

#### AppImage, for any distribution

The AppImage runs on most distributions without installing anything. Download the one for your processor:

- **`Pb.Notes-…-x64.AppImage`** for Intel or AMD.
- **`Pb.Notes-…-arm64.AppImage`** for ARM.

Allow it to run, then start it, from a terminal in the folder you downloaded it to:

```sh
chmod +x Pb.Notes-*.AppImage
./Pb.Notes-*.AppImage
```

Or, in your file manager, open the file's properties, allow it to run as a program, and double-click it.

It doesn't add itself to your app launcher, so your dock may show it with a generic icon, and it doesn't update itself: to get a new version, download the new AppImage. To remove it, delete the file. A tool such as Gear Lever can add it to your launcher, with its icon.

If it says FUSE is missing, install `fuse3` (on Debian or Ubuntu, `sudo apt install fuse3`), or start it with `--appimage-extract-and-run`.

On Ubuntu 23.10 and later, the AppImage starts without Chromium's sandbox, which keeps web content from reaching the rest of your system: Ubuntu blocks the sandbox for apps like it. The `.deb` keeps the sandbox, so on Ubuntu, prefer the `.deb`.

#### Arch Linux and Omarchy

Download the pacman package for your processor:

- **`pbnotes-bin-…-x86_64.pkg.tar.zst`** for Intel or AMD.
- **`pbnotes-bin-…-aarch64.pkg.tar.zst`** for ARM.

Install it from the folder you downloaded it to:

```sh
sudo pacman -U ./pbnotes-bin-*.pkg.tar.zst
```

Pb Notes then shows up in your app launcher. It isn't on the AUR, so `yay -Syu` won't update it: to get a new version, download and install it the same way. To uninstall, run `sudo pacman -R pbnotes-bin`.

The package is made from the `.deb` by the recipe in [`app/arch/PKGBUILD`](app/arch/PKGBUILD). To build it yourself instead, run `makepkg -si` there, in a checkout of the release's tag.

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

`packages/ledger/` (`@pbnotes/ledger`, the event log), `packages/files/` (`@pbnotes/files`, hash-named files beside it) and `packages/graph/` (`@pbnotes/graph`, what the events mean, for the app and for any other program that reads a folder) are packages the app depends on through the workspace. The first two have no dependencies of their own, and `graph` depends only on the Markdown parser it reads links with. `npm test` in any of these folders runs its tests.

What stays the same whatever the product becomes is in [DNA.md](DNA.md). The folder format is [packages/ledger/multi-writer.md](packages/ledger/multi-writer.md).
