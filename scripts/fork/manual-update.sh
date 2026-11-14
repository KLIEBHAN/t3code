#!/usr/bin/env bash
# One update.sh run for the Dock applet (update-applet.applescript). The applet
# starts it in the background and only watches, so closing the applet cannot
# stop the update. Output streams into update.log as the run goes.
#
# While it runs, $FORK_STATE_DIR/manual-progress.<run> holds the current step
# for the applet as `<step of 4>|<text>`. At the end
# $FORK_STATE_DIR/manual-result.<run> holds the summary. <run> is MANUAL_RUN_ID,
# which the applet picks for each run, so a run it stopped watching cannot
# answer for a later one:
#   status=<installed|waiting|current|busy|failed> version=<version> current=<version> runs=<n>
# `version` is the new build for `waiting`, otherwise the installed app;
# `current` is the app that was installed before the run. `waiting` means a
# build is ready but the app runs; `runs` counts its unfinished runs, which a
# restart would interrupt, and is empty when unknown.
#
# Usage: scripts/fork/manual-update.sh [--restart]
set -uo pipefail

cd "$(dirname "$0")/../.."
. scripts/fork/config.sh

log="$FORK_STATE_DIR/logs/update.log"
run_id="${MANUAL_RUN_ID:-last}"
progress="$FORK_STATE_DIR/manual-progress.$run_id"
result="$FORK_STATE_DIR/manual-result.$run_id"
mkdir -p "$(dirname "$log")"
echo "1|Prüft auf neue Versionen …" >"$progress"
echo "update: manual run of $(date '+%Y-%m-%d %H:%M')" >>"$log"
before="$(fork_app_commit "$FORK_APP_PATH")"
version_of() {
  plutil -extract CFBundleShortVersionString raw "$1/Contents/Info.plist" 2>/dev/null || true
}
current="$(version_of "$FORK_APP_PATH")"

# Every line goes to the log; a few also become the progress line. The last
# line is update.sh's exit code, added below.
busy=0
code=1
while IFS= read -r line; do
  case "$line" in
    "manual: exit "*)
      code="${line#manual: exit }"
      continue
      ;;
  esac
  printf '%s\n' "$line" >>"$log"
  case "$line" in
    "update: another run is active"*) busy=1 ;;
    "sync: merging "*) echo "2|Spielt die neue Upstream-Version ein …" >"$progress" ;;
    "sync: asking the model"*) echo "2|Löst einen Merge-Konflikt mit KI …" >"$progress" ;;
    "build: "*" at "*) echo "3|Baut die App (2–3 Minuten) …" >"$progress" ;;
    "fetch: "*" from "*) echo "3|Lädt die neue Version vom Build-Mac …" >"$progress" ;;
    "update: restarting "*) echo "4|Beendet die App für das Update …" >"$progress" ;;
    "update: installing "*) echo "4|Installiert die neue Version …" >"$progress" ;;
  esac
done < <(
  scripts/fork/update.sh "$@" 2>&1
  echo "manual: exit $?"
)

installed="$(fork_app_commit "$FORK_APP_PATH")"
staged="$(fork_app_commit "$FORK_STAGED_APP")"
runs=""
pids="$(fork_app_pids)"
if [ -n "$pids" ] && [ "$(wc -l <<<"$pids" | tr -d ' ')" = 1 ]; then
  runs="$(fork_active_runs "$(fork_app_home "$pids")")"
fi

if [ "$busy" = 1 ]; then
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
summary="status=$status version=$version current=$current runs=$runs"
# Written in one step, so the applet never reads half a line.
printf '%s\n' "$summary" >"$result.tmp" && mv "$result.tmp" "$result"
rm -f "$progress"
echo "$summary"
