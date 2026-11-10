#!/usr/bin/env bash
# Starts an installed Pb Notes on a virtual screen and checks that its window
# shows and that it is still running a few seconds later (#356). This catches a
# package that installs but can't start: the wrong CPU's Electron, a missing
# library, a sandbox that won't come up.
#
#   smoke-launch.sh <command> [args...]
#
# Needs Xvfb and xwininfo. The app gets a throwaway HOME, so it never sees real
# settings or folders.
set -euo pipefail

[ $# -ge 1 ] || {
  echo "usage: $0 <command> [args...]" >&2
  exit 2
}

tmp=$(mktemp -d)
app=
xvfb=
cleanup() {
  [ -n "$app" ] && kill -TERM -- "-$app" 2>/dev/null || true
  [ -n "$xvfb" ] && kill "$xvfb" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

fail() {
  echo "::error::$1"
  echo "--- app output ---"
  cat "$tmp/app.log" || true
  exit 1
}

# Xvfb picks a free display and writes its number to fd 3.
Xvfb -displayfd 3 -screen 0 1280x800x24 -nolisten tcp 3>"$tmp/display" 2>"$tmp/xvfb.log" &
xvfb=$!
for _ in $(seq 100); do
  [ -s "$tmp/display" ] && break
  sleep 0.1
done
[ -s "$tmp/display" ] || {
  cat "$tmp/xvfb.log"
  echo "::error::Xvfb did not start"
  exit 1
}

mkdir -p "$tmp/home"
# Unset WAYLAND_DISPLAY so that, run from a Wayland desktop, the app still
# opens on the virtual screen and not the real one.
env -u WAYLAND_DISPLAY \
  DISPLAY=":$(cat "$tmp/display")" \
  HOME="$tmp/home" \
  XDG_CONFIG_HOME="$tmp/home/.config" \
  XDG_DATA_HOME="$tmp/home/.local/share" \
  setsid "$@" >"$tmp/app.log" 2>&1 &
app=$!

# The window's title is "Pb Notes" and its class "pbnotes".
shown=
for _ in $(seq 60); do
  kill -0 "$app" 2>/dev/null || fail "Pb Notes exited before its window showed"
  if DISPLAY=":$(cat "$tmp/display")" xwininfo -root -tree | grep -Eq '"Pb Notes"|"pbnotes"'; then
    shown=1
    break
  fi
  sleep 1
done
[ -n "$shown" ] || fail "No Pb Notes window after 60 seconds"

sleep 5
kill -0 "$app" 2>/dev/null || fail "Pb Notes exited within 5 seconds of showing its window"

echo "Pb Notes started and showed its window."
