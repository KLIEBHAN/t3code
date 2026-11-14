#!/usr/bin/env bash
# Compiles the Dock applet (update-applet.applescript) to
# ~/Applications/T3 Code Fork Update.app with this checkout's paths filled in.
# setup.sh creates it; update.sh keeps it current. See FORK.md.
#
# Usage: scripts/fork/install-applet.sh [--if-changed]
#   --if-changed  only refresh an applet that exists and whose source changed;
#                 a running applet is left for a later run
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

applet="$HOME/Applications/T3 Code Fork Update.app"
# Outside the bundle: a file added to it would break its signature.
stamp="$FORK_STATE_DIR/applet-source.sha256"
work="$(dirname "$applet")/.fork-applet"
incoming="$work/incoming/$(basename "$applet")"
previous="$work/previous/$(basename "$applet")"

# Puts back an applet that a stopped swap left aside.
restore_previous() {
  if [ ! -e "$applet" ] && [ -d "$previous" ]; then
    mv "$previous" "$applet"
  fi
}
restore_previous
# Only empty folders go; a swap in progress elsewhere keeps its files.
rmdir "$work/incoming" "$work/previous" "$work" 2>/dev/null || true

source="$(mktemp)"
cleanup_work=0
trap 'rm -f "$source"; if [ "$cleanup_work" = 1 ]; then restore_previous; rm -rf "$work"; fi' EXIT
sed -e "s#@REPO@#$PWD#" -e "s#@STATE@#$FORK_STATE_DIR#" scripts/fork/update-applet.applescript >"$source"
icon_png="scripts/fork/applet-icon.png"
hash="$(cat "$source" "$icon_png" | shasum -a 256 | cut -d' ' -f1)"

if [ "${1:-}" = "--if-changed" ]; then
  [ -d "$applet" ] || exit 0
  [ "$(cat "$stamp" 2>/dev/null || true)" != "$hash" ] || exit 0
  # An AppleScript applet writes its script back when it quits, which would undo the refresh.
  # grep without -q reads all of ps, so pipefail cannot see a broken pipe here.
  if ps -axo comm= | grep -F "$applet/Contents/MacOS/" >/dev/null; then
    echo "applet: the Dock applet is open; a later run refreshes it"
    exit 0
  fi
fi

# Compile next to the applet and swap only a bundle that compiled, so a broken
# template leaves the installed applet in place.
mkdir -p "$(dirname "$applet")" "$(dirname "$stamp")"
# osacompile writes a bundle only for a name that ends in .app, hence the folders.
cleanup_work=1
rm -rf "$work"
mkdir -p "$(dirname "$incoming")" "$(dirname "$previous")"
osacompile -o "$incoming" "$source"
# The applet's own icon, then a fresh ad hoc signature over the changed bundle.
iconset="$work/applet.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256; do
  sips -z "$size" "$size" "$icon_png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$icon_png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
cp "$icon_png" "$iconset/icon_512x512.png"
iconutil -c icns "$iconset" -o "$incoming/Contents/Resources/applet.icns"
codesign --force --sign - "$incoming" 2>/dev/null
[ ! -d "$applet" ] || mv "$applet" "$previous"
if ! mv "$incoming" "$applet"; then
  echo "applet: could not move the new applet into place" >&2
  exit 1
fi
printf '%s\n' "$hash" >"$stamp"
echo "applet: compiled $applet"
