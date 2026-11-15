#!/usr/bin/env bash
# One update run for the fork app: sync with upstream, build when the branch
# has no matching build, and install the build while the app is closed. A
# running app is not replaced. At night, while no thread runs, it is quit,
# updated, and started again; otherwise its build waits for the next run. See
# FORK.md.
#
# With fork.buildHost set (setup.sh --build-host), this Mac neither syncs nor
# builds: every run fetches the build host's newest app (fetch-app.sh).
#
# Usage: scripts/fork/update.sh [--scheduled] [--restart]
#   --scheduled  launchd mode, started every hour: sync and build at most once
#                a day, from 04:00; every run installs a waiting build.
#   --restart    restart a running app for a waiting build now, whatever the
#                hour and whether threads run; the Dock applet asks first.
# Exit codes: 0 done, 1 sync, build, fetch, or install failed, 2 wrong checkout state.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

# One run at a time. lockf holds the lock for the child and the kernel releases
# it when that process ends, however it ends.
if [ "${FORK_UPDATE_LOCKED:-}" != 1 ]; then
  mkdir -p "$FORK_STATE_DIR/logs"
  # Puts the time in front of every line of the run, stderr included, for the
  # log. It ignores the signals that stop a run and reads until update.sh has
  # exited: a closed pipe would end update.sh before it brings the app back.
  stamp_lines() {
    trap '' TERM INT HUP
    local line
    while IFS= read -r line || [ -n "$line" ]; do
      printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line"
    done
  }
  status=0
  {
    # A Mac that installs another Mac's builds moves these scripts before it
    # fetches, so an app never meets scripts older than itself: to the fork
    # branch's head when that contains the app it is about to fetch, as on the
    # build host, otherwise to the app's own commit. The head keeps script changes
    # merged since the last build, such as a new applet, from going back until
    # the next build. Away from the build host they stay with the app this Mac
    # has. Here, before the locked run starts, no script is mid-read: bash has
    # parsed this whole block already.
    if [ -n "$FORK_BUILD_HOST" ] && [ "$(git branch --show-current)" = "$FORK_BRANCH" ]; then
      wanted="$(scripts/fork/fetch-app.sh --commit 2>/dev/null || true)"
      [ -n "$wanted" ] || wanted="$(fork_app_commit "$FORK_STAGED_APP")"
      [ -n "$wanted" ] || wanted="$(fork_app_commit "$FORK_APP_PATH")"
      target=""
      if [ -z "$wanted" ]; then
        :
      elif ! git fetch --quiet --depth 1 origin "$wanted"; then
        echo "update: could not fetch the scripts of ${wanted:0:10}" >&2
      else
        target="$wanted"
        # The checkout is shallow; 50 commits reach any recent build, and a build
        # beyond them is treated as not contained, which keeps its commit.
        if git fetch --quiet --depth 50 origin "$FORK_BRANCH" && git merge-base --is-ancestor "$wanted" FETCH_HEAD 2>/dev/null; then
          target="$(git rev-parse FETCH_HEAD)"
        fi
      fi
      # An app built before this Mac's role existed has no scripts for it; keep the current ones.
      if [ -n "$target" ] && [ "$target" != "$(git rev-parse HEAD)" ] && [ -n "$(git ls-tree --name-only "$target" scripts/fork/fetch-app.sh)" ]; then
        git checkout --quiet -B "$FORK_BRANCH" "$target" || echo "update: could not move the scripts to ${target:0:10}" >&2
      fi
    fi
    locked=0
    FORK_UPDATE_LOCKED=1 lockf -s -k -t 0 "$FORK_STATE_DIR/update.lock" scripts/fork/update.sh "$@" || locked=$?
    if [ "$locked" = 75 ]; then
      echo "update: another run is active"
      locked=0
    fi
    exit "$locked"
  } 2>&1 | stamp_lines || status=$?
  exit "$status"
fi

scheduled=0
restart_now=0
for arg in "$@"; do
  case "$arg" in
    --scheduled) scheduled=1 ;;
    --restart) restart_now=1 ;;
    *)
      echo "update: unknown argument $arg" >&2
      exit 2
      ;;
  esac
done

# Best effort: a banner on this Mac. The log has the details.
notify() {
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "T3 Code (Fork)"' -e 'end run' "$1" >/dev/null 2>&1 || true
}

# A failure: the banner, and in a scheduled run, which nobody watches, also a
# push to the phone through the senders setup.sh copied. A push that fails
# leaves a line in the log.
alert() {
  notify "$1"
  [ "$scheduled" = 1 ] && [ -x "$FORK_PUSH_DIR/python3" ] || return 0
  local message
  message="$(scutil --get ComputerName 2>/dev/null || hostname -s): $1"
  if [ -f "$FORK_PUSH_DIR/bark/scripts/send.py" ]; then
    "$FORK_PUSH_DIR/python3" "$FORK_PUSH_DIR/bark/scripts/send.py" --event fehler --title "$FORK_APP_NAME" --message "$message" >/dev/null 2>&1 ||
      echo "update: the Bark push failed" >&2
  fi
  if [ -f "$FORK_PUSH_DIR/ntfy/scripts/publish.py" ]; then
    "$FORK_PUSH_DIR/python3" "$FORK_PUSH_DIR/ntfy/scripts/publish.py" --priority 4 --title "$FORK_APP_NAME" --message "$message" >/dev/null 2>&1 ||
      echo "update: the ntfy push failed" >&2
  fi
}

# Anything this checkout builds gets installed, so it has to be the fork branch.
warned="$FORK_STATE_DIR/branch-warned"
if [ "$(git branch --show-current)" != "$FORK_BRANCH" ]; then
  echo "update: check out $FORK_BRANCH first" >&2
  # Only a scheduled run marks a failure as announced: a manual run's banner
  # reaches no phone, so it must not silence the scheduled push.
  if [ ! -f "$warned" ]; then
    [ "$scheduled" = 0 ] || touch "$warned"
    alert "Kein Update: Der Checkout steht nicht auf $FORK_BRANCH."
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
  # Runs every hour, so a lasting failure is announced once, as for the branch above.
  failed="$FORK_STATE_DIR/fetch-failed"
  if scripts/fork/fetch-app.sh; then
    rm -f "$failed"
  else
    status=1
    if [ ! -f "$failed" ]; then
      [ "$scheduled" = 0 ] || touch "$failed"
      alert "Das Update ließ sich nicht von $FORK_BUILD_HOST holen. Log: $FORK_STATE_DIR/logs"
    fi
  fi
elif [ "$full" = 1 ]; then
  date +%s >"$stamp"
  echo "update: daily sync and build"
  if ! scripts/fork/sync-upstream.sh; then
    status=1
    alert "Upstream ließ sich nicht einspielen. Log: $FORK_STATE_DIR/logs"
  fi
  head="$(git rev-parse HEAD)"
  if [ "$(fork_app_commit "$FORK_STAGED_APP")" != "$head" ] && [ "$(fork_app_commit "$FORK_APP_PATH")" != "$head" ]; then
    if ! scripts/fork/build-app.sh; then
      status=1
      alert "Der Build ist fehlgeschlagen. Log: $FORK_STATE_DIR/logs"
    fi
  fi
fi

# Quits the app process $1 the way the Dock does. Upstream answers the first
# signal with a clean shutdown and ends a stalled one on a second signal after
# ten seconds.
stop_app() {
  local attempt wait
  for attempt in 1 2; do
    kill -TERM "$1" 2>/dev/null || true
    for ((wait = 0; wait < 30; wait++)); do
      fork_app_running || return 0
      sleep 1
    done
  done
  return 1
}

# Starts the app on the T3 home $1 with the environment the Dock gives it:
# `open` hands its own environment to the app, and this script's has the build
# toolchain on PATH.
start_app() {
  local environment=(HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" SHELL="${SHELL:-/bin/zsh}"
    TMPDIR="${TMPDIR:-/tmp}" PATH=/usr/bin:/bin:/usr/sbin:/sbin)
  [ -z "${SSH_AUTH_SOCK:-}" ] || environment+=(SSH_AUTH_SOCK="$SSH_AUTH_SOCK")
  [ "$1" = "$HOME/.t3" ] || environment+=(T3CODE_HOME="$1")
  env -i "${environment[@]}" open -g -a "$FORK_APP_PATH"
}

# Brings back an app this run quit. Also the exit handler, so a step that fails
# after the quit cannot leave the app closed.
quit_home=""
relaunch() {
  [ -n "$quit_home" ] || return 0
  local home="$quit_home"
  quit_home=""
  if ! start_app "$home"; then
    echo "update: could not start $FORK_APP_NAME again" >&2
    alert "Die App ließ sich nach dem Update nicht wieder starten."
  fi
}
trap relaunch EXIT
# A stopped run still brings the app back: `exit` runs the EXIT trap.
trap 'exit 1' TERM INT HUP

staged="$(fork_app_commit "$FORK_STAGED_APP")"
if [ -n "$staged" ] && [ "$staged" != "$(fork_app_commit "$FORK_APP_PATH")" ]; then
  hour="$((10#$(date +%H)))"
  pids="$(fork_app_pids)"
  # One app only: with two, the homes and their threads cannot be told apart by one check.
  if [ -n "$pids" ] && [ "$(wc -l <<<"$pids" | tr -d ' ')" = 1 ] && {
    [ "$restart_now" = 1 ] ||
      { [ "$hour" -ge "$FORK_RESTART_FROM_HOUR" ] && [ "$hour" -lt "$FORK_RESTART_BEFORE_HOUR" ]; }
  }; then
    app_home="$(fork_app_home "$pids")"
    if [ "$restart_now" = 1 ] || [ "$(fork_active_runs "$app_home")" = 0 ]; then
      echo "update: restarting $FORK_APP_NAME on $app_home for the update"
      # Set first: a run stopped while the app quits must still bring it back.
      quit_home="$app_home"
      if ! stop_app "$pids"; then
        quit_home=""
        echo "update: $FORK_APP_NAME did not quit" >&2
      fi
    fi
  fi

  incoming="$FORK_APP_PATH.incoming"
  previous="$FORK_APP_PATH.previous"
  rm -rf "$incoming" "$previous"
  # Copy next to the target first, so the swap itself is two renames. The check
  # comes after the copy: an app started during the copy keeps its bundle.
  if ! fork_app_running; then
    echo "update: installing ${staged:0:10}"
    ditto "$FORK_STAGED_APP" "$incoming"
  fi
  if fork_app_running; then
    rm -rf "$incoming"
    echo "update: a new build waits until $FORK_APP_NAME is closed or idle at night"
    if [ "$(cat "$FORK_STATE_DIR/announced" 2>/dev/null)" != "$staged" ]; then
      echo "$staged" >"$FORK_STATE_DIR/announced"
      notify "Update bereit. Es wird nachts installiert, wenn kein Thread läuft, oder sobald die App beendet ist."
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
      alert "Das Update ließ sich nicht installieren. Log: $FORK_STATE_DIR/logs"
    fi
  fi
  relaunch
fi

# The applet's source moves with these scripts; a failure here leaves the old applet working.
scripts/fork/install-applet.sh --if-changed || echo "update: could not refresh the Dock applet" >&2
exit "$status"
