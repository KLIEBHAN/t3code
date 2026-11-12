#!/usr/bin/env bash
# One-time setup of the fork app on this Mac. Safe to run again: it keeps what
# exists. See FORK.md.
#   1. A check that the signing identity from config.sh is in the keychain.
#   2. The fork's T3 home, marked so the app leaves the `t3` command alone.
#   3. The launchd job that runs update.sh every hour from this checkout.
#
# Usage: scripts/fork/setup.sh [--no-job]
#   --no-job  skip step 3, for a checkout that only builds
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

if ! security find-identity -v -p codesigning | grep -F "\"$FORK_SIGN_IDENTITY\"" >/dev/null; then
  echo "setup: no valid signing identity \"$FORK_SIGN_IDENTITY\" in the keychain; see FORK.md" >&2
  exit 1
fi

mkdir -p "$FORK_T3_HOME/userdata"
# The app installs a `t3` command on its first launch unless this file exists.
touch "$FORK_T3_HOME/userdata/cli-command-first-launch"

if [ "${1:-}" != "--no-job" ]; then
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
