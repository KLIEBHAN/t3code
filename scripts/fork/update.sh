#!/usr/bin/env bash
# One update run for the fork app: sync with upstream, build when the branch
# has no matching build, and install the build while the app is closed. A
# running app is not replaced; its build waits for the next run. See FORK.md.
#
# With fork.buildHost set (setup.sh --build-host), this Mac neither syncs nor
# builds: every run fetches the build host's newest app (fetch-app.sh).
#
# Usage: scripts/fork/update.sh [--scheduled]
#   --scheduled  launchd mode, started every hour: sync and build at most once
#                a day, from 04:00; every run installs a waiting build.
# Exit codes: 0 done, 1 sync, build, fetch, or install failed, 2 wrong checkout state.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

# One run at a time. lockf holds the lock for the child and the kernel releases
# it when that process ends, however it ends.
if [ "${FORK_UPDATE_LOCKED:-}" != 1 ]; then
  mkdir -p "$FORK_STATE_DIR/logs"
  # A Mac that installs another Mac's builds keeps these scripts at the commit
  # of its newest app. Here, before the locked run starts, no script is mid-read:
  # bash has parsed this whole block already.
  if [ -n "$FORK_BUILD_HOST" ]; then
    wanted="$(fork_app_commit "$FORK_STAGED_APP")"
    [ -n "$wanted" ] || wanted="$(fork_app_commit "$FORK_APP_PATH")"
    if [ -n "$wanted" ] && [ "$wanted" != "$(git rev-parse HEAD)" ] && [ "$(git branch --show-current)" = "$FORK_BRANCH" ]; then
      if ! git fetch --quiet --depth 1 origin "$wanted"; then
        echo "update: could not fetch the scripts of ${wanted:0:10}" >&2
      # An app built before this Mac's role existed has no scripts for it; keep the current ones.
      elif [ -n "$(git ls-tree --name-only FETCH_HEAD scripts/fork/fetch-app.sh)" ]; then
        git checkout --quiet -B "$FORK_BRANCH" FETCH_HEAD || echo "update: could not move the scripts to ${wanted:0:10}" >&2
      fi
    fi
  fi
  status=0
  FORK_UPDATE_LOCKED=1 lockf -s -k -t 0 "$FORK_STATE_DIR/update.lock" scripts/fork/update.sh "$@" || status=$?
  if [ "$status" = 75 ]; then
    echo "update: another run is active"
    exit 0
  fi
  exit "$status"
fi

scheduled=0
[ "${1:-}" = "--scheduled" ] && scheduled=1

# Best effort: a banner on this Mac. The log has the details.
notify() {
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "T3 Code (Fork)"' -e 'end run' "$1" >/dev/null 2>&1 || true
}

# Anything this checkout builds gets installed, so it has to be the fork branch.
warned="$FORK_STATE_DIR/branch-warned"
if [ "$(git branch --show-current)" != "$FORK_BRANCH" ]; then
  echo "update: check out $FORK_BRANCH first" >&2
  if [ ! -f "$warned" ]; then
    touch "$warned"
    notify "Kein Update: Der Checkout steht nicht auf $FORK_BRANCH."
  fi
  exit 2
fi
rm -f "$warned"

status=0
stamp="$FORK_STATE_DIR/last-sync"
full=1
if [ "$scheduled" = 1 ]; then
  age=$(($(date +%s) - $(cat "$stamp" 2>/dev/null || echo 0)))
  if [ "$((10#$(date +%H)))" -lt 4 ] || [ "$age" -lt $((20 * 3600)) ]; then
    full=0
  fi
fi

if [ -n "$FORK_BUILD_HOST" ]; then
  # Runs every hour, so a lasting failure is announced once.
  failed="$FORK_STATE_DIR/fetch-failed"
  if scripts/fork/fetch-app.sh; then
    rm -f "$failed"
  else
    status=1
    if [ ! -f "$failed" ]; then
      touch "$failed"
      notify "Das Update ließ sich nicht von $FORK_BUILD_HOST holen. Log: $FORK_STATE_DIR/logs"
    fi
  fi
elif [ "$full" = 1 ]; then
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
  incoming="$FORK_APP_PATH.incoming"
  previous="$FORK_APP_PATH.previous"
  rm -rf "$incoming" "$previous"
  # Copy next to the target first, so the swap itself is two renames. The check
  # comes after the copy: an app started during the copy keeps its bundle.
  if ! fork_app_running; then
    ditto "$FORK_STAGED_APP" "$incoming"
  fi
  if fork_app_running; then
    rm -rf "$incoming"
    echo "update: a new build waits until $FORK_APP_NAME is closed"
    if [ "$(cat "$FORK_STATE_DIR/announced" 2>/dev/null)" != "$staged" ]; then
      echo "$staged" >"$FORK_STATE_DIR/announced"
      notify "Update bereit. Es wird installiert, sobald die App beendet ist."
    fi
  else
    # The installed app stays reachable as $previous until the new one is in place.
    [ ! -d "$FORK_APP_PATH" ] || mv "$FORK_APP_PATH" "$previous"
    if mv "$incoming" "$FORK_APP_PATH"; then
      rm -rf "$previous" "$FORK_STAGED_APP"
      version="$(plutil -extract CFBundleShortVersionString raw "$FORK_APP_PATH/Contents/Info.plist")"
      echo "update: installed $version (${staged:0:10})"
      notify "Aktualisiert auf $version."
    else
      [ ! -d "$previous" ] || mv "$previous" "$FORK_APP_PATH"
      status=1
      echo "update: could not move the new build into place; the installed app is unchanged" >&2
      notify "Das Update ließ sich nicht installieren. Log: $FORK_STATE_DIR/logs"
    fi
  fi
fi
exit "$status"
