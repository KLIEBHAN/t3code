#!/usr/bin/env bash
# Builds and installs the iOS fork app (T3 Code (Fork)) using a Personal Team signing profile.
#
# Usage: scripts/fork/build-ios.sh [--device [name-or-udid] | --simulator [name-or-udid]] [--debug]
# Environment overrides:
#   FORK_IOS_BUNDLE_ID  (default: com.kliebhan.t3code-fork)
#   FORK_IOS_TEAM_ID    (default: extracted from FORK_SIGN_IDENTITY or Q8MH2BGE2S)
#   FORK_IOS_APP_NAME   (default: T3 Code (Fork))
#   FORK_IOS_SCHEME     (default: t3code-fork)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

mode="device"
target=""
configuration="Release"
while [ $# -gt 0 ]; do
  case "$1" in
    --device)
      mode="device"
      if [ $# -gt 1 ] && [[ "$2" != --* ]]; then
        target="$2"
        shift
      fi
      ;;
    --simulator)
      mode="simulator"
      if [ $# -gt 1 ] && [[ "$2" != --* ]]; then
        target="$2"
        shift
      fi
      ;;
    --debug)
      configuration="Debug"
      ;;
    --release)
      configuration="Release"
      ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "build-ios: unknown argument $1" >&2
      exit 2
      ;;
  esac
  shift
done

detect_team_id() {
  if [ -n "${FORK_IOS_TEAM_ID:-}" ]; then
    printf '%s\n' "$FORK_IOS_TEAM_ID"
    return
  fi
  security find-certificate -c "$FORK_SIGN_IDENTITY" -p 2>/dev/null \
    | openssl x509 -noout -subject -nameopt RFC2253 2>/dev/null \
    | sed -n -E 's/.*OU[[:space:]]*=[[:space:]]*([A-Z0-9]+).*/\1/p' || true
}

resolve_simulator_udid() {
  local query="$1"
  xcrun simctl list devices available -j | python3 -c '
import json, sys
query = sys.argv[1]
data = json.load(sys.stdin)
booted = []
other = []
for devices in data.get("devices", {}).values():
    for dev in devices:
        if not dev.get("isAvailable", True):
            continue
        if dev.get("udid") == query or dev.get("name") == query:
            (booted if dev.get("state") == "Booted" else other).append(dev["udid"])
match = (booted + other)[:1]
if match:
    print(match[0])
' "$query"
}

if ! command -v pod >/dev/null 2>&1; then
  echo "build-ios: CocoaPods ('pod') is required for iOS builds. Install it with: brew install cocoapods" >&2
  exit 1
fi

team_id="$(detect_team_id)"
if [ -z "$team_id" ] && [ "$mode" = "device" ]; then
  echo "build-ios: could not read Apple Team ID from '$FORK_SIGN_IDENTITY'; set FORK_IOS_TEAM_ID" >&2
  exit 1
fi

if [ "$mode" = "simulator" ] && [ -n "$target" ]; then
  sim_udid="$(resolve_simulator_udid "$target")"
  if [ -z "$sim_udid" ]; then
    echo "build-ios: no available iOS simulator matches '$target'" >&2
    exit 1
  fi
  target="$sim_udid"
fi

export APP_VARIANT=production
export EXPO_NO_GIT_STATUS=1
export T3CODE_IOS_PERSONAL_TEAM=1
export T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="${FORK_IOS_BUNDLE_ID:-$FORK_BUNDLE_ID}"
export T3CODE_MOBILE_APP_NAME="${FORK_IOS_APP_NAME:-$FORK_APP_NAME}"
export T3CODE_MOBILE_SCHEME="${FORK_IOS_SCHEME:-t3code-fork}"
export T3CODE_MOBILE_UPDATES_ENABLED=0

mkdir -p "$FORK_STATE_DIR"
lock_dir="$FORK_STATE_DIR/build-ios.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "build-ios: another iOS build is already running ($lock_dir)" >&2
  exit 1
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

cd apps/mobile
echo "build-ios: prebuilding $T3CODE_MOBILE_APP_NAME ($T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID, team ${team_id:-none})"
# Leave DEVELOPMENT_TEAM unset during prebuild so expo run:ios --device configures signing
# with T3CODE_IOS_TEAM_ID and passes -allowProvisioningUpdates / -allowProvisioningDeviceRegistration.
T3CODE_IOS_TEAM_ID="" vp exec expo prebuild --clean --platform ios

run_args=(--configuration "$configuration")
if [ "$configuration" = "Release" ]; then
  run_args+=(--no-bundler)
fi
if [ "$mode" = "device" ]; then
  if [ -n "$target" ]; then
    run_args+=(--device "$target")
  else
    run_args+=(--device)
  fi
elif [ -n "$target" ]; then
  run_args+=(--device "$target")
fi

echo "build-ios: building and installing ($mode, $configuration)"
T3CODE_IOS_TEAM_ID="$team_id" vp exec expo run:ios "${run_args[@]}"
