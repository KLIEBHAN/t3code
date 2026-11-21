#!/usr/bin/env bash
# Stages and wirelessly installs iOS fork updates for the paired iPhone:
#   1. Rebuilds staged-ios/T3CodeFork.app when iOS-relevant files changed since
#      the last build, or when the 7-day Personal Team profile has <= 48h left.
#   2. Wirelessly installs the staged bundle over local Wi-Fi via devicectl
#      during the night window (or immediately with --now / <= 24h left).
#   3. Sends a Bark/ntfy reminder if the installed profile has <= 36h left
#      without a successful wireless renewal (for example while away from home).
#
# Usage: scripts/fork/update-ios.sh [--scheduled] [--now] [--build-only] [--device <udid>]
# Exit codes: 0 done, 1 build failed, 2 invalid arguments or non-fork branch with --scheduled.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

case "${1:-}" in
  -h | --help)
    sed -n '2,11p' "$0"
    exit 0
    ;;
esac

# One iOS update run at a time; lockf releases on exit.
if [ "${FORK_IOS_UPDATE_LOCKED:-}" != 1 ]; then
  mkdir -p "$FORK_STATE_DIR"
  locked=0
  FORK_IOS_UPDATE_LOCKED=1 lockf -s -k -t 0 "$FORK_STATE_DIR/update-ios.lock" \
    scripts/fork/update-ios.sh "$@" || locked=$?
  if [ "$locked" = 75 ]; then
    echo "update-ios: another run is active"
    exit 0
  fi
  exit "$locked"
fi

scheduled=0
install_now=0
build_only=0
device_arg=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scheduled) scheduled=1 ;;
    --now) install_now=1 ;;
    --build-only) build_only=1 ;;
    --device)
      if [ $# -lt 2 ]; then
        echo "update-ios: --device needs a UDID or device name" >&2
        exit 2
      fi
      device_arg="$2"
      shift
      ;;
    -h | --help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "update-ios: unknown argument $1" >&2
      exit 2
      ;;
  esac
  shift
done

# Only runs on the build Mac when enabled and CocoaPods is installed.
if [ -n "$FORK_BUILD_HOST" ] || [ "$FORK_IOS_AUTO_UPDATE" = 0 ]; then
  exit 0
fi
if ! command -v pod >/dev/null 2>&1; then
  echo "update-ios: CocoaPods not installed; skipping iOS update"
  exit 0
fi
if [ "$scheduled" = 1 ] && [ "$(git branch --show-current)" != "$FORK_BRANCH" ]; then
  echo "update-ios: check out $FORK_BRANCH first" >&2
  exit 2
fi

push_ios() {
  [ "$scheduled" = 1 ] || return 0
  fork_push_phone "$1" "$2" "$3"
}

format_local_expiry() {
  python3 -c '
import datetime, sys
ts = int(sys.argv[1])
print(datetime.datetime.fromtimestamp(ts).astimezone().strftime("%d.%m. %H:%M"))
' "$1" 2>/dev/null || printf '%s' "$1"
}

ios_paths_changed() {
  local base="$1" head="$2" changed
  if [ -z "$base" ]; then
    return 0
  fi
  if [ "$base" = "$head" ]; then
    return 1
  fi
  if ! changed="$(git diff --name-only "$base" "$head" 2>/dev/null)"; then
    return 0
  fi
  [ -n "$changed" ] && grep -qE '^(apps/mobile/|packages/|pnpm-lock\.yaml$|package\.json$|assets/|scripts/lib/(brand-assets|public-config)\.ts$)' <<<"$changed"
}

query="${device_arg:-$FORK_IOS_DEVICE}"
device_udid="$(fork_ios_resolve_device "$query")"

now="$(date +%s)"
hour="$((10#$(date +%H)))"
today="$(date '+%Y-%m-%d')"
head="$(git rev-parse HEAD)"

staged_commit=""
staged_expires=""
staged_version=""
if [ -d "$FORK_IOS_STAGED_APP" ] && [ -f "$FORK_IOS_STAGED_META" ]; then
  staged_commit="$(fork_ios_meta_get "$FORK_IOS_STAGED_META" commit)"
  staged_expires="$(fork_ios_meta_get "$FORK_IOS_STAGED_META" profile_expires)"
  staged_version="$(fork_ios_meta_get "$FORK_IOS_STAGED_META" version)"
fi

installed_device="$(fork_ios_meta_get "$FORK_IOS_INSTALLED_META" device)"
installed_commit="$(fork_ios_meta_get "$FORK_IOS_INSTALLED_META" commit)"
installed_expires="$(fork_ios_meta_get "$FORK_IOS_INSTALLED_META" profile_expires)"

renew_seconds="$((FORK_IOS_RENEW_BEFORE_HOURS * 3600))"
warn_seconds="$((FORK_IOS_WARN_BEFORE_HOURS * 3600))"
emergency_seconds="$((FORK_IOS_EMERGENCY_INSTALL_HOURS * 3600))"

status=0
if [ -z "$device_udid" ]; then
  if [ -n "$query" ]; then
    echo "update-ios: configured device '$query' not found in paired iOS devices; skipping build/install"
  else
    echo "update-ios: no unique paired physical iOS device; skipping build/install"
  fi
else
  # Step 1: Build/stage when iOS code changed or the Personal Team profile nears expiry.
  needs_code_build=0
  needs_profile_renewal=0
  ref_commit="${staged_commit:-$installed_commit}"
  if [ ! -d "$FORK_IOS_STAGED_APP" ]; then
    if [ -z "$installed_commit" ] || ios_paths_changed "$installed_commit" "$head"; then
      needs_code_build=1
    fi
  elif ios_paths_changed "$ref_commit" "$head"; then
    needs_code_build=1
  fi

  active_expires="${staged_expires:-$installed_expires}"
  renew_attempted_file="$FORK_STATE_DIR/ios-renew-attempted"
  if [ -n "$active_expires" ] && [ "$((active_expires - now))" -le "$renew_seconds" ]; then
    renew_key="${active_expires}:${today}"
    if [ "$scheduled" = 1 ] && [ "$(cat "$renew_attempted_file" 2>/dev/null || true)" = "$renew_key" ]; then
      echo "update-ios: profile renewal for expiry $active_expires already attempted today"
    else
      needs_profile_renewal=1
    fi
  elif [ ! -d "$FORK_IOS_STAGED_APP" ] && [ -z "$installed_expires" ]; then
    needs_code_build=1
  fi

  failed_file="$FORK_STATE_DIR/ios-build-failed"
  if [ "$needs_code_build" = 1 ] || [ "$needs_profile_renewal" = 1 ]; then
    fail_key="${head}:${today}"
    if [ "$scheduled" = 1 ] && [ "$(cat "$failed_file" 2>/dev/null || true)" = "$fail_key" ]; then
      echo "update-ios: skipping failed build for ${head:0:10} today"
    else
      build_args=(--stage)
      if [ "$needs_profile_renewal" = 1 ]; then
        build_args+=(--renew-profile)
        echo "update-ios: renewing Personal Team profile and staging ${head:0:10}"
      else
        echo "update-ios: staging iOS build for ${head:0:10}"
      fi
      build_rc=0
      scripts/fork/build-ios.sh "${build_args[@]}" || build_rc=$?
      if [ "$build_rc" = 0 ]; then
        rm -f "$failed_file"
        prev_expires="$active_expires"
        staged_commit="$(fork_ios_meta_get "$FORK_IOS_STAGED_META" commit)"
        staged_expires="$(fork_ios_meta_get "$FORK_IOS_STAGED_META" profile_expires)"
        staged_version="$(fork_ios_meta_get "$FORK_IOS_STAGED_META" version)"
        if [ "$needs_profile_renewal" = 1 ] && [ -n "$prev_expires" ]; then
          if [ -n "$staged_expires" ] && [ "$staged_expires" -gt "$prev_expires" ]; then
            rm -f "$renew_attempted_file"
          else
            printf '%s\n' "${prev_expires}:${today}" >"$renew_attempted_file"
          fi
        fi
      elif [ "$build_rc" = 75 ]; then
        echo "update-ios: another iOS build is already running; skipping"
      else
        echo "$fail_key" >"$failed_file"
        status=1
        push_ios fehler 4 "iOS-Build für T3 Code (Fork) fehlgeschlagen. Log: $FORK_STATE_DIR/logs"
      fi
    fi
  fi

  # Step 2: Wirelessly install the staged bundle when newer or with a fresher profile.
  install_needed=0
  if [ "$build_only" = 0 ] && [ -d "$FORK_IOS_STAGED_APP" ] && [ -n "$staged_commit" ]; then
    if [ "$installed_device" != "$device_udid" ] || [ "$staged_commit" != "$installed_commit" ]; then
      install_needed=1
    elif [ -n "$staged_expires" ] && { [ -z "$installed_expires" ] || [ "$staged_expires" -gt "$installed_expires" ]; }; then
      install_needed=1
    fi
  fi

  if [ "$install_needed" = 1 ]; then
    in_night_window=0
    if [ "$hour" -ge "$FORK_RESTART_FROM_HOUR" ] && [ "$hour" -lt "$FORK_RESTART_BEFORE_HOUR" ]; then
      in_night_window=1
    fi
    emergency_due=0
    if [ -n "$installed_expires" ] && [ "$((installed_expires - now))" -le "$emergency_seconds" ]; then
      emergency_due=1
    fi

    if [ "$install_now" = 1 ] || [ "$scheduled" = 0 ] || [ "$in_night_window" = 1 ] || [ "$emergency_due" = 1 ]; then
      echo "update-ios: installing ${staged_commit:0:10} wirelessly onto $device_udid"
      if xcrun devicectl device install app --timeout 60 --device "$device_udid" "$FORK_IOS_STAGED_APP"; then
        installed_at="$(date +%s)"
        staged_built_at="$(fork_ios_meta_get "$FORK_IOS_STAGED_META" built_at)"
        fork_ios_meta_write "$FORK_IOS_INSTALLED_META" \
          "device=$device_udid" \
          "commit=$staged_commit" \
          "version=$staged_version" \
          "built_at=$staged_built_at" \
          "profile_expires=$staged_expires" \
          "installed_at=$installed_at"
        installed_commit="$staged_commit"
        installed_expires="$staged_expires"
        rm -f "$FORK_STATE_DIR/ios-expiry-warned"
        expiry_label=""
        [ -z "$staged_expires" ] || expiry_label=" (Profil bis $(format_local_expiry "$staged_expires"))"
        echo "update-ios: installed ${staged_commit:0:10} on $device_udid"
        push_ios info 3 "iOS-App aktualisiert${expiry_label}."
      else
        echo "update-ios: device $device_udid unreachable right now; staged build waits for next run"
      fi
    else
      echo "update-ios: staged build ${staged_commit:0:10} waits for night window (${FORK_RESTART_FROM_HOUR}:00–${FORK_RESTART_BEFORE_HOUR}:00)"
    fi
  fi
fi

# Step 3: Remind once via Bark/ntfy when the installed profile has <= 36h remaining.
if [ -n "$installed_expires" ] && [ "$((installed_expires - now))" -le "$warn_seconds" ]; then
  warned_file="$FORK_STATE_DIR/ios-expiry-warned"
  if [ "$(cat "$warned_file" 2>/dev/null || true)" != "$installed_expires" ]; then
    expiry_text="$(format_local_expiry "$installed_expires")"
    echo "update-ios: installed Personal Team profile expires at $expiry_text; notifying"
    if [ "$scheduled" = 1 ]; then
      echo "$installed_expires" >"$warned_file"
      push_ios rueckfrage 4 "iOS-Profil für T3 Code (Fork) läuft am $expiry_text ab. Kurz ins Heim-WLAN oder scripts/fork/update-ios.sh --now starten."
    fi
  fi
fi

exit "$status"
