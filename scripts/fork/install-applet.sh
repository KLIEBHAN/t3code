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
source="$(mktemp)"
trap 'rm -f "$source"' EXIT
sed -e "s#@REPO@#$PWD#" -e "s#@STATE@#$FORK_STATE_DIR#" scripts/fork/update-applet.applescript >"$source"
hash="$(shasum -a 256 "$source" | cut -d' ' -f1)"

if [ "${1:-}" = "--if-changed" ]; then
  [ -d "$applet" ] || exit 0
  [ "$(cat "$stamp" 2>/dev/null || true)" != "$hash" ] || exit 0
  # An AppleScript applet writes its script back when it quits, which would undo the refresh.
  if ps -axo comm= | grep -qF "$applet/Contents/MacOS/"; then
    echo "applet: the Dock applet is open; a later run refreshes it"
    exit 0
  fi
fi

mkdir -p "$(dirname "$applet")" "$(dirname "$stamp")"
rm -rf "$applet"
osacompile -o "$applet" "$source"
printf '%s\n' "$hash" >"$stamp"
echo "applet: compiled $applet"
