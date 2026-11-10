#!/usr/bin/env bash
# Sets the PKGBUILD beside this script to a version, fills in its checksums
# and writes the .SRCINFO the AUR needs (#361).
#
#   update.sh <version>
#
# The checksums come from the files on that version's Release, both CPUs'
# .deb among them, so it has to be published first. Needs makepkg and
# updpkgsums (pacman-contrib), and won't run as root, as makepkg won't.
set -euo pipefail

version=${1:?usage: $0 <version>}
[[ $version =~ ^[0-9]+(\.[0-9]+)*$ ]] || {
  echo "Not a version pacman accepts: $version" >&2
  exit 2
}

cd "$(dirname "$0")"
sed -i -e "s/^pkgver=.*/pkgver=$version/" -e "s/^pkgrel=.*/pkgrel=1/" PKGBUILD
updpkgsums
makepkg --printsrcinfo >.SRCINFO
