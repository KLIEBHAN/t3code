#!/usr/bin/env bash
# One update.sh run for the Dock applet (update-applet.applescript), logged like
# the scheduled runs. Its last line sums up the result for the applet:
#   status=<installed|waiting|current|busy|failed> version=<version> runs=<n>
# `waiting` means a build is ready but the app runs; `runs` counts its
# unfinished runs, which a restart would interrupt.
#
# Usage: scripts/fork/manual-update.sh [--restart]
set -uo pipefail

cd "$(dirname "$0")/../.."
. scripts/fork/config.sh

log="$FORK_STATE_DIR/logs/update.log"
mkdir -p "$(dirname "$log")"
before="$(fork_app_commit "$FORK_APP_PATH")"
output="$(scripts/fork/update.sh "$@" 2>&1)"
code=$?
{
  echo "update: manual run of $(date '+%Y-%m-%d %H:%M')"
  printf '%s\n' "$output"
} >>"$log"

installed="$(fork_app_commit "$FORK_APP_PATH")"
staged="$(fork_app_commit "$FORK_STAGED_APP")"
version_of() {
  plutil -extract CFBundleShortVersionString raw "$1/Contents/Info.plist" 2>/dev/null || true
}
runs=""
pids="$(fork_app_pids)"
if [ -n "$pids" ] && [ "$(wc -l <<<"$pids" | tr -d ' ')" = 1 ]; then
  runs="$(fork_active_runs "$(fork_app_home "$pids")")"
fi

# update.sh exits 0 when another run holds the lock; its message is the only sign.
if grep -q "^update: another run is active" <<<"$output"; then
  status=busy
elif [ "$code" != 0 ]; then
  status=failed
elif [ -n "$staged" ] && [ "$staged" != "$installed" ]; then
  status=waiting
elif [ "$installed" != "$before" ]; then
  status=installed
else
  status=current
fi
if [ "$status" = waiting ]; then
  version="$(version_of "$FORK_STAGED_APP")"
else
  version="$(version_of "$FORK_APP_PATH")"
fi
echo "status=$status version=$version runs=$runs"
