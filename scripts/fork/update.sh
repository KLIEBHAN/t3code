#!/usr/bin/env bash
# One update run for the fork app: sync with upstream, build when the branch
# has no matching build, and install the build while the app is closed. A
# running app is never replaced; its build waits for the next run. See FORK.md.
#
# Usage: scripts/fork/update.sh [--scheduled]
#   --scheduled  launchd mode, started every hour: sync and build at most once
#                a day, from 04:00; every run installs a waiting build.
# Exit codes: 0 done, 1 sync or build failed, 2 wrong checkout state.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

scheduled=0
[ "${1:-}" = "--scheduled" ] && scheduled=1

mkdir -p "$FORK_STATE_DIR/logs"
lock="$FORK_STATE_DIR/update.lock"
if ! mkdir "$lock" 2>/dev/null; then
  if kill -0 "$(cat "$lock/pid" 2>/dev/null)" 2>/dev/null; then
    echo "update: another run is active"
    exit 0
  fi
  echo "update: taking over the lock of a run that ended without releasing it"
fi
echo $$ >"$lock/pid"
trap 'rm -rf "$lock"' EXIT

# Best effort: a banner on this Mac. The log has the details.
notify() {
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "T3 Code (Fork)"' -e 'end run' "$1" >/dev/null 2>&1 || true
}

status=0
stamp="$FORK_STATE_DIR/last-sync"
full=1
if [ "$scheduled" = 1 ]; then
  age=$(($(date +%s) - $(cat "$stamp" 2>/dev/null || echo 0)))
  if [ "$((10#$(date +%H)))" -lt 4 ] || [ "$age" -lt $((20 * 3600)) ]; then
    full=0
  fi
fi

if [ "$full" = 1 ]; then
  date +%s >"$stamp"
  echo "update: run of $(date '+%Y-%m-%d %H:%M')"
  if ! scripts/fork/sync-upstream.sh; then
    status=1
    notify "Upstream ließ sich nicht einspielen. Log: $FORK_STATE_DIR/logs"
  fi
  head="$(git rev-parse HEAD)"
  if [ "$(fork_app_commit "$FORK_STAGED_APP")" != "$head" ] && [ "$(fork_app_commit "$FORK_APP_PATH")" != "$head" ]; then
    if ! scripts/fork/build-app.sh; then
      status=1
      notify "Der Build ist fehlgeschlagen. Log: $FORK_STATE_DIR/logs"
    fi
  fi
fi

staged="$(fork_app_commit "$FORK_STAGED_APP")"
if [ -n "$staged" ] && [ "$staged" != "$(fork_app_commit "$FORK_APP_PATH")" ]; then
  if fork_app_running; then
    echo "update: a new build waits until $FORK_APP_NAME is closed"
    if [ "$(cat "$FORK_STATE_DIR/announced" 2>/dev/null)" != "$staged" ]; then
      echo "$staged" >"$FORK_STATE_DIR/announced"
      notify "Update bereit. Es wird installiert, sobald die App beendet ist."
    fi
  else
    # Copy next to the target first, so the swap is two renames on one volume.
    incoming="$FORK_APP_PATH.incoming"
    rm -rf "$incoming"
    ditto "$FORK_STAGED_APP" "$incoming"
    rm -rf "$FORK_APP_PATH"
    mv "$incoming" "$FORK_APP_PATH"
    rm -rf "$FORK_STAGED_APP"
    version="$(plutil -extract CFBundleShortVersionString raw "$FORK_APP_PATH/Contents/Info.plist")"
    echo "update: installed $version (${staged:0:10})"
    notify "Aktualisiert auf $version."
  fi
fi
exit "$status"
