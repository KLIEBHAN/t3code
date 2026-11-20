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
    | openssl x509 -noout -subject 2>/dev/null \
    | sed -n -E 's/.*OU=([A-Z0-9]+).*/\1/p' || true
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

export APP_VARIANT=production
export EXPO_NO_GIT_STATUS=1
export T3CODE_IOS_PERSONAL_TEAM=1
export T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="${FORK_IOS_BUNDLE_ID:-$FORK_BUNDLE_ID}"
export T3CODE_IOS_TEAM_ID="$team_id"
export T3CODE_MOBILE_APP_NAME="${FORK_IOS_APP_NAME:-$FORK_APP_NAME}"
export T3CODE_MOBILE_SCHEME="${FORK_IOS_SCHEME:-t3code-fork}"
export T3CODE_MOBILE_UPDATES_ENABLED=0

cd apps/mobile
echo "build-ios: prebuilding $T3CODE_MOBILE_APP_NAME ($T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID, team ${team_id:-none})"
vp exec expo prebuild --clean --platform ios

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
vp exec expo run:ios "${run_args[@]}"
