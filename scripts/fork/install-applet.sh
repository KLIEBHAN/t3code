#!/usr/bin/env bash
# Compiles the Dock app (update-app.swift) to
# ~/Applications/T3 Code Fork Update.app with this checkout's paths in its
# Info.plist. Needs the Swift compiler (Xcode or the Command Line Tools).
# setup.sh creates it; update.sh keeps it current. See FORK.md.
#
# Usage: scripts/fork/install-applet.sh [--if-changed]
#   --if-changed  only refresh an app that exists and whose source changed;
#                 an open app is left for a later run
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

applet="$HOME/Applications/T3 Code Fork Update.app"
executable="T3 Code Fork Update"
# Outside the bundle: a file added to it would break its signature.
stamp="$FORK_STATE_DIR/applet-source.sha256"
work="$(dirname "$applet")/.fork-applet"
incoming="$work/incoming/$(basename "$applet")"
previous="$work/previous/$(basename "$applet")"

# Puts back an app that a stopped swap left aside.
restore_previous() {
  if [ ! -e "$applet" ] && [ -d "$previous" ]; then
    mv "$previous" "$applet"
  fi
}
restore_previous
# Only empty folders go; a swap in progress elsewhere keeps its files.
rmdir "$work/incoming" "$work/previous" "$work" 2>/dev/null || true

plist="$(mktemp)"
cleanup_work=0
trap 'rm -f "$plist"; if [ "$cleanup_work" = 1 ]; then restore_previous; rm -rf "$work"; fi' EXIT
# plutil escapes the values, so any path is safe here.
plutil -create xml1 "$plist"
for entry in \
  "CFBundleExecutable=$executable" \
  "CFBundleIdentifier=$FORK_BUNDLE_ID.update" \
  "CFBundleName=T3 Code Fork Update" \
  "CFBundlePackageType=APPL" \
  "CFBundleShortVersionString=1.0" \
  "CFBundleIconFile=AppIcon" \
  "CFBundleIconName=AppIcon" \
  "LSMinimumSystemVersion=14.0" \
  "T3ForkRepoPath=$PWD" \
  "T3ForkStateDir=$FORK_STATE_DIR" \
  "T3ForkAppPath=$FORK_APP_PATH" \
  "T3ForkBuildHost=$FORK_BUILD_HOST"; do
  plutil -insert "${entry%%=*}" -string "${entry#*=}" "$plist"
done
icon_dir="scripts/fork/applet-icon"
# This script and the filled-in Info.plist are part of the hash too, so a
# change to the build steps or this Mac's paths reaches the app.
hash="$(cat scripts/fork/update-app.swift "$plist" "$icon_dir/Assets.car" "$icon_dir/AppIcon.icns" scripts/fork/install-applet.sh | shasum -a 256 | cut -d' ' -f1)"

if [ "${1:-}" = "--if-changed" ]; then
  [ -d "$applet" ] || exit 0
  [ "$(cat "$stamp" 2>/dev/null || true)" != "$hash" ] || exit 0
  # Replacing an open app would pull its bundle away under it.
  # grep without -q reads all of ps, so pipefail cannot see a broken pipe here.
  if ps -axo comm= | grep -F "$applet/Contents/MacOS/" >/dev/null; then
    echo "applet: the Dock app is open; a later run refreshes it"
    exit 0
  fi
fi

# Build next to the app and swap only a bundle that compiled, so a broken
# source leaves the installed app in place.
mkdir -p "$(dirname "$applet")" "$(dirname "$stamp")"
cleanup_work=1
rm -rf "$work"
mkdir -p "$incoming/Contents/MacOS" "$incoming/Contents/Resources" "$(dirname "$previous")"
xcrun swiftc -O -parse-as-library -o "$incoming/Contents/MacOS/$executable" scripts/fork/update-app.swift
cp "$plist" "$incoming/Contents/Info.plist"
# The app's own icon, built by make-applet-icon.sh.
cp "$icon_dir/Assets.car" "$icon_dir/AppIcon.icns" "$incoming/Contents/Resources/"
codesign --force --sign - "$incoming" 2>/dev/null
[ ! -d "$applet" ] || mv "$applet" "$previous"
if ! mv "$incoming" "$applet"; then
  echo "applet: could not move the new app into place" >&2
  exit 1
fi
printf '%s\n' "$hash" >"$stamp"
echo "applet: compiled $applet"
