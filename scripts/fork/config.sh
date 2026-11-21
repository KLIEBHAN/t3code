# Settings shared by the fork scripts. Source it from the repository root; see FORK.md.
# shellcheck shell=bash

FORK_BRANCH="${FORK_BRANCH:-pi-prompt-suggestions}"
FORK_APP_NAME="T3 Code (Fork)"
FORK_BUNDLE_ID=com.kliebhan.t3code-fork
FORK_APP_PATH="/Applications/$FORK_APP_NAME.app"
# Build output, the staged app, and logs.
FORK_STATE_DIR="${FORK_STATE_DIR:-$HOME/workspace/t3code-fork-build}"
FORK_STAGED_APP="$FORK_STATE_DIR/staged/$FORK_APP_NAME.app"
FORK_IOS_STAGED_DIR="$FORK_STATE_DIR/staged-ios"
FORK_IOS_STAGED_APP="$FORK_IOS_STAGED_DIR/T3CodeFork.app"
FORK_IOS_STAGED_META="$FORK_IOS_STAGED_DIR/meta.env"
FORK_IOS_INSTALLED_META="$FORK_STATE_DIR/ios-installed.env"
FORK_IOS_DERIVED_DATA="$FORK_STATE_DIR/ios-derived-data"
# Optional pinned iPhone UDID/name for automatic wireless iOS updates (git config fork.iosDevice).
FORK_IOS_DEVICE="${FORK_IOS_DEVICE:-$(git config --get fork.iosDevice || true)}"
FORK_IOS_AUTO_UPDATE="${FORK_IOS_AUTO_UPDATE:-1}"
# Personal Team profiles last 7 days: renew staged build 48h before expiry, warn at 36h,
# and allow wireless install outside the night window when <= 24h remain.
FORK_IOS_RENEW_BEFORE_HOURS="${FORK_IOS_RENEW_BEFORE_HOURS:-48}"
FORK_IOS_WARN_BEFORE_HOURS="${FORK_IOS_WARN_BEFORE_HOURS:-36}"
FORK_IOS_EMERGENCY_INSTALL_HOURS="${FORK_IOS_EMERGENCY_INSTALL_HOURS:-24}"
# Phone pushes for failures of the hourly run: setup.sh copies the bark and ntfy
# skill senders from FORK_SKILLS_DIR to FORK_PUSH_DIR.
FORK_SKILLS_DIR="${FORK_SKILLS_DIR:-$HOME/.pi/agent/skills}"
FORK_PUSH_DIR="$FORK_STATE_DIR/push"
# An Apple-issued identity from the login keychain. macOS ties the app's keychain
# and privacy grants to its team, so they survive every rebuild.
FORK_SIGN_IDENTITY="${FORK_SIGN_IDENTITY:-Apple Development: fabian.kliebhan@gmail.com (7VHQ3DW64R)}"
FORK_LAUNCHD_LABEL=com.kliebhan.t3code-fork.update
# update.sh restarts a running app for an update only between these hours, and
# only while no thread runs.
FORK_RESTART_FROM_HOUR="${FORK_RESTART_FROM_HOUR:-2}"
FORK_RESTART_BEFORE_HOUR="${FORK_RESTART_BEFORE_HOUR:-6}"
# Set on a Mac that installs another Mac's builds instead of making its own:
# the SSH host it fetches the app from. Stored in this checkout's git config.
FORK_BUILD_HOST="${FORK_BUILD_HOST:-$(git config --get fork.buildHost || true)}"
# Pi arguments for the model that repairs a failed merge.
FORK_MERGE_PI_ARGS=(
  --no-extensions -e "$HOME/.pi/agent/extensions/cpa.ts"
  --model "${FORK_MERGE_MODEL:-cpa/cpa-worker-plus}" --thinking high
)
FORK_MERGE_TIMEOUT_SECONDS=1800

# launchd starts jobs with a bare PATH.
PATH="$HOME/.cargo/bin:$HOME/.pi/agent/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# Vite+ provides vp and the Node version the repository pins. Only a Mac that builds has it.
VP_ENV="${VP_ENV:-$HOME/workspace/t3code-fork-toolchain/vite-plus/env}"
if [ -z "$FORK_BUILD_HOST" ] || [ -f "$VP_ENV" ]; then
  # shellcheck source=/dev/null
  . "$VP_ENV"
fi
export PATH

# The commit an app bundle was built from, or nothing when the bundle is missing.
fork_app_commit() {
  plutil -extract T3ForkCommit raw "$1/Contents/Info.plist" 2>/dev/null || true
}

fork_app_running() {
  # Executable paths, not arguments: a shell or editor that only names the app does not count.
  ps -axo comm= | grep -F "$FORK_APP_PATH/Contents/" >/dev/null
}

# The running app's main processes, one PID per line: those launchd started.
# An app started twice, each time with another T3 home, gives two.
fork_app_pids() {
  ps -axo pid=,ppid=,comm= | awk -v exe="$FORK_APP_PATH/Contents/MacOS/" '$2 == 1 && index($0, exe) { print $1 }'
}

# The T3 home a running app process was started with; ~/.t3 unless its
# environment names another.
fork_app_home() {
  local home
  home="$(ps eww -o command= -p "$1" | sed -n -E 's/.* T3CODE_HOME=//p' | sed -E 's/ [A-Za-z_][A-Za-z0-9_]*=.*//')"
  printf '%s\n' "${home:-$HOME/.t3}"
}

# How many runs are unfinished in a T3 home. Prints nothing when the database
# cannot be read, which callers must not take for zero.
fork_active_runs() {
  sqlite3 "file:$1/userdata/statev2.sqlite?mode=ro" \
    "select count(*) from orchestration_v2_projection_runs where status in ('preparing','queued','starting','running','waiting');" 2>/dev/null || true
}

# Sends $3 with this Mac's name to the phone through the copied Bark/ntfy senders.
# $1 is the Bark event (info, fertig, rueckfrage, fehler), $2 is the ntfy priority.
fork_push_phone() {
  if [ ! -x "$FORK_PUSH_DIR/python3" ]; then
    echo "push: no Python for phone pushes; run scripts/fork/setup.sh" >&2
    return 0
  fi
  local message
  message="$(scutil --get ComputerName 2>/dev/null || hostname -s): $3"
  if [ -f "$FORK_PUSH_DIR/bark/scripts/send.py" ]; then
    "$FORK_PUSH_DIR/python3" "$FORK_PUSH_DIR/bark/scripts/send.py" --event "$1" --title "$FORK_APP_NAME" --message "$message" >/dev/null 2>&1 ||
      echo "push: the Bark push failed" >&2
  fi
  if [ -f "$FORK_PUSH_DIR/ntfy/scripts/publish.py" ]; then
    "$FORK_PUSH_DIR/python3" "$FORK_PUSH_DIR/ntfy/scripts/publish.py" --priority "$2" --title "$FORK_APP_NAME" --message "$message" >/dev/null 2>&1 ||
      echo "push: the ntfy push failed" >&2
  fi
}

# Reads key=$2 from a plain key=value metadata file $1 without sourcing it.
fork_ios_meta_get() {
  [ -f "$1" ] || return 0
  awk -F= -v key="$2" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$1"
}

# Atomically writes key=value pairs ($2..) to $1.
fork_ios_meta_write() {
  local target="$1"
  shift
  mkdir -p "$(dirname "$target")"
  printf '%s\n' "$@" >"$target.tmp" && mv "$target.tmp" "$target"
}

# Unix epoch expiration of an iOS .app bundle or .mobileprovision file, or empty.
fork_ios_profile_expires() {
  local profile="$1" raw
  if [ -d "$profile" ]; then
    profile="$profile/embedded.mobileprovision"
  fi
  [ -f "$profile" ] || return 0
  raw="$(security cms -D -i "$profile" 2>/dev/null | plutil -extract ExpirationDate raw - 2>/dev/null || true)"
  [ -n "$raw" ] || return 0
  python3 -c '
import datetime, sys
dt = datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
print(int(dt.timestamp()))
' "$raw" 2>/dev/null || true
}

# Resolves a paired physical iOS device UDID via devicectl.
# With $1, matches exact UDID or name; without $1, succeeds only if exactly one paired physical device exists.
fork_ios_resolve_device() {
  local query="${1:-}"
  xcrun devicectl list devices --json-output - 2>/dev/null | python3 -c '
import json, sys
query = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
devices = []
for dev in data.get("result", {}).get("devices", []):
    hw = dev.get("hardwareProperties") or {}
    props = dev.get("deviceProperties") or {}
    conn = dev.get("connectionProperties") or {}
    if hw.get("reality") != "physical" or conn.get("pairingState") != "paired":
        continue
    udid = hw.get("udid") or ""
    name = props.get("name") or ""
    if not udid:
        continue
    if query:
        if udid == query or name == query:
            print(udid)
            sys.exit(0)
    else:
        devices.append(udid)
if not query and len(devices) == 1:
    print(devices[0])
' "$query" 2>/dev/null || true
}
