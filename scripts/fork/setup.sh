#!/usr/bin/env bash
# One-time setup of the fork app on this Mac. Safe to run again: it keeps what
# exists. See FORK.md.
#   1. A check that the signing identity from config.sh is in the keychain.
#   2. The Dock applet for updates by hand, ~/Applications/T3 Code Fork Update.app.
#   3. Copies of the bark and ntfy skill senders with their .env and a link to
#      Python 3.10 or newer, through which the hourly run reports failures to
#      the phone. Run setup.sh again when
#      those credentials change.
#   4. The launchd job that runs update.sh every hour from this checkout.
#
# Usage: scripts/fork/setup.sh [--no-job] [--build-host <ssh host>] [--ios-device <udid-or-name>]
#   --no-job      skip steps 2 to 4, for a checkout that only builds
#   --build-host  this Mac installs the app that Mac builds, and makes none
#                 itself: no step 1, and update.sh fetches instead of building
#   --ios-device  pin the paired iPhone UDID or name for automatic wireless iOS updates
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
    --ios-device)
      if [ $# -lt 2 ]; then
        echo "setup: --ios-device needs a UDID or device name" >&2
        exit 2
      fi
      git config fork.iosDevice "$2"
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

# Links $FORK_PUSH_DIR/python3 to the first Python 3.10 or newer, which the
# skill senders need; macOS's /usr/bin/python3 is older. launchd's PATH has
# only the system directories, so update.sh calls the link. A Python in a
# folder under the macOS privacy check would stall the job, so those are skipped.
link_push_python() {
  local candidate
  for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 || true)" /usr/bin/python3; do
    case "$candidate" in
      "$HOME/Documents/"* | "$HOME/Desktop/"* | "$HOME/Downloads/"*) continue ;;
    esac
    if [ -x "$candidate" ] && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
      # Called as an if condition, where set -e is off.
      mkdir -p "$FORK_PUSH_DIR" && ln -sfn "$candidate" "$FORK_PUSH_DIR/python3" && return 0
      break
    fi
  done
  rm -f "$FORK_PUSH_DIR/python3"
  echo "setup: could not link a Python 3.10 or newer to $FORK_PUSH_DIR; failures reach no phone" >&2
  return 1
}

# Copies the sender $2 of skill $1 and the skill's .env to $FORK_PUSH_DIR/$1,
# where update.sh finds it. The launchd job must not read the skills
# themselves: they live in ~/Documents, where every access goes through the
# macOS privacy check and an unanswered prompt stalls it for all apps.
install_push_sender() {
  local skill="$FORK_SKILLS_DIR/$1" target="$FORK_PUSH_DIR/$1"
  if [ ! -f "$skill/scripts/$2" ] || [ ! -f "$skill/.env" ]; then
    echo "setup: no $1 skill with .env in $FORK_SKILLS_DIR; failures reach no phone through $1"
    return 0
  fi
  mkdir -p "$target/scripts"
  (
    umask 077
    cp "$skill/scripts/$2" "$target/scripts/$2"
    cp "$skill/.env" "$target/.env"
  )
  chmod 600 "$target/.env"
  if "$FORK_PUSH_DIR/python3" "$target/scripts/$2" --check >/dev/null 2>&1; then
    echo "setup: failures of the hourly run are pushed through $1"
  else
    echo "setup: the copied $1 sender reports an invalid configuration; run $target/scripts/$2 --check" >&2
  fi
}

if [ "$job" = 1 ]; then
  scripts/fork/install-applet.sh
  if link_push_python; then
    install_push_sender bark send.py
    install_push_sender ntfy publish.py
  fi

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
