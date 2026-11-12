#!/usr/bin/env bash
# One-time setup of the fork app on this Mac. Safe to run again: it keeps what
# exists. See FORK.md.
#   1. A check that the signing identity from config.sh is in the keychain.
#   2. The launchd job that runs update.sh every hour from this checkout.
#
# Usage: scripts/fork/setup.sh [--no-job] [--build-host <ssh host>]
#   --no-job      skip step 2, for a checkout that only builds
#   --build-host  this Mac installs the app that Mac builds, and makes none
#                 itself: no step 1, and update.sh fetches instead of building
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Before config.sh: it loads the build toolchain unless a build host is set.
job=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-job) job=0 ;;
    --build-host)
      if [ $# -lt 2 ]; then
        echo "setup: --build-host needs an SSH host" >&2
        exit 2
      fi
      git config fork.buildHost "$2"
      shift
      ;;
    *)
      echo "setup: unknown argument $1" >&2
      exit 2
      ;;
  esac
  shift
done
. scripts/fork/config.sh

if [ -z "$FORK_BUILD_HOST" ] && ! security find-identity -v -p codesigning | grep -F "\"$FORK_SIGN_IDENTITY\"" >/dev/null; then
  echo "setup: no valid signing identity \"$FORK_SIGN_IDENTITY\" in the keychain; see FORK.md" >&2
  exit 1
fi

if [ "$job" = 1 ]; then
  plist="$HOME/Library/LaunchAgents/$FORK_LAUNCHD_LABEL.plist"
  mkdir -p "$FORK_STATE_DIR/logs" "$(dirname "$plist")"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$FORK_LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PWD/scripts/fork/update.sh</string>
    <string>--scheduled</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PWD</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$FORK_STATE_DIR/logs/update.log</string>
  <key>StandardErrorPath</key>
  <string>$FORK_STATE_DIR/logs/update.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$FORK_LAUNCHD_LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "setup: launchd runs $PWD/scripts/fork/update.sh at minute 30 of every hour"
fi
