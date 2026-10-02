#!/bin/sh
# Regenerates icon.icns, icon.ico and icon.png from ../../logo.svg.
# macOS only: uses sips and iconutil. Run it again whenever the logo changes.
set -eu
cd "$(dirname "$0")"
logo=../../logo.svg
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# macOS: Apple's icon grid is an 824px rounded square centred on a 1024px
# canvas. The bare logo fills its canvas, so it would sit oversized and
# square-cornered next to every other Dock icon.
{
  echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
  echo '<clipPath id="c"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>'
  echo '<g clip-path="url(#c)"><g transform="translate(100 100) scale(1.609375)">'
  grep -E '^ *<(rect|path) ' "$logo"
  echo '</g></g></svg>'
} > "$tmp/mac.svg"
mkdir "$tmp/icon.iconset"
for s in 16 32 128 256 512; do
  sips -s format png -z $s $s "$tmp/mac.svg" --out "$tmp/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -s format png -z $((s * 2)) $((s * 2)) "$tmp/mac.svg" --out "$tmp/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$tmp/icon.iconset" -o icon.icns

# macOS 26 and later restyle a bare .icns: the artwork gets a shadow and the
# background a glassy shade. icon.icon (Icon Composer) declares the layers
# instead, so the system leaves them flat. icon.json there is hand-written;
# only the artwork is generated, without the logo's white backdrop and
# scaled to 88% so the square border clears the rounder system mask.
{
  echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
  echo '<g transform="translate(512 512) scale(1.76) translate(-256 -256)">'
  grep -E '^ *<(rect|path) ' "$logo" | grep -v 'fill="#fff"'
  echo '</g></svg>'
} > icon.icon/Assets/foreground.svg

# Linux: the logo as it is.
sips -s format png -z 512 512 "$logo" --out icon.png >/dev/null

# Windows: an .ico is a small directory in front of PNGs.
for s in 16 32 48 256; do
  sips -s format png -z $s $s "$logo" --out "$tmp/$s.png" >/dev/null
done
python3 - "$tmp" <<'PY'
import struct, sys
sizes = [16, 32, 48, 256]
pngs = [open(f"{sys.argv[1]}/{s}.png", "rb").read() for s in sizes]
offset = 6 + 16 * len(sizes)
out = struct.pack("<HHH", 0, 1, len(sizes))
for s, png in zip(sizes, pngs):
    out += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(png), offset)
    offset += len(png)
open("icon.ico", "wb").write(out + b"".join(pngs))
PY
