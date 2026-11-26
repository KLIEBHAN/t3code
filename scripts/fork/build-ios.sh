#!/usr/bin/env bash
# Builds (and optionally installs) the iOS fork app (T3 Code (Fork)) using a
# Personal Team signing profile. Caches Expo prebuild output unless native inputs
# change or --clean is passed.
#
# Usage:
#   scripts/fork/build-ios.sh [--device [name-or-udid] | --stage | --simulator [name-or-udid]]
#                             [--debug | --release] [--clean] [--renew-profile]
# Environment overrides:
#   FORK_IOS_BUNDLE_ID  (default: com.kliebhan.t3code-fork)
#   FORK_IOS_TEAM_ID    (default: extracted from FORK_SIGN_IDENTITY)
#   FORK_IOS_APP_NAME   (default: T3 Code (Fork))
#   FORK_IOS_SCHEME     (default: t3code-fork)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

case "${1:-}" in
  -h | --help)
    sed -n '2,13p' "$0"
    exit 0
    ;;
esac

# One iOS build at a time; lockf releases the lock automatically on exit.
if [ "${FORK_IOS_BUILD_LOCKED:-}" != 1 ]; then
  mkdir -p "$FORK_STATE_DIR"
  locked=0
  FORK_IOS_BUILD_LOCKED=1 lockf -s -k -t 0 "$FORK_STATE_DIR/build-ios.lock" \
    scripts/fork/build-ios.sh "$@" || locked=$?
  if [ "$locked" = 75 ]; then
    echo "build-ios: another iOS build is already running" >&2
    exit 75
  fi
  exit "$locked"
fi

mode="device"
target=""
configuration="Release"
clean_prebuild=0
renew_profile=0
while [ $# -gt 0 ]; do
  case "$1" in
    --device)
      mode="device"
      if [ $# -gt 1 ] && [[ "$2" != --* ]]; then
        target="$2"
        shift
      fi
      ;;
    --stage)
      mode="stage"
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
    --clean)
      clean_prebuild=1
      ;;
    --renew-profile)
      renew_profile=1
      ;;
    -h | --help)
      sed -n '2,13p' "$0"
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
if [ -z "$team_id" ] && [ "$mode" != "simulator" ]; then
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

device_udid=""
if [ "$mode" = "device" ]; then
  query="${target:-$FORK_IOS_DEVICE}"
  device_udid="$(fork_ios_resolve_device "$query")"
  if [ -z "$device_udid" ]; then
    if [ -n "$query" ]; then
      echo "build-ios: no paired physical iOS device matches '$query'" >&2
    else
      echo "build-ios: could not identify a unique paired physical iOS device; pass --device <udid-or-name>" >&2
    fi
    exit 1
  fi
fi

export APP_VARIANT=production
export EXPO_NO_GIT_STATUS=1
export T3CODE_IOS_PERSONAL_TEAM=1
export T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="${FORK_IOS_BUNDLE_ID:-$FORK_BUNDLE_ID}"
export T3CODE_MOBILE_APP_NAME="${FORK_IOS_APP_NAME:-$FORK_APP_NAME}"
export T3CODE_MOBILE_SCHEME="${FORK_IOS_SCHEME:-t3code-fork}"
export T3CODE_MOBILE_UPDATES_ENABLED=0

# Prints a deterministic list of apps/mobile's native/plugin npm packages (version + patch_hash)
# and matching patches/ digests so desktop/server or pure-JS bumps do not trigger cold prebuilds.
# Falls back to hashing raw package.json, pnpm-lock.yaml, and all patches/ if the lockfile layout
# does not list apps/mobile.
mobile_native_deps_digest() {
  python3 - <<'PY'
import hashlib, json, os, posixpath, re, urllib.parse

def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def emit_fallback() -> None:
    for path in ("apps/mobile/package.json", "pnpm-lock.yaml"):
        if os.path.isfile(path):
            print(f"fallback-file:{path}:{sha256_file(path)}")
    if os.path.isdir("patches"):
        for fname in sorted(os.listdir("patches")):
            fpath = os.path.join("patches", fname)
            if os.path.isfile(fpath):
                print(f"fallback-patch:{fname}:{sha256_file(fpath)}")

if not os.path.isfile("pnpm-lock.yaml") or not os.path.isfile("apps/mobile/package.json"):
    emit_fallback()
    raise SystemExit(0)

Q = "'\""
importers: dict[str, dict[str, str]] = {}
snapshots: dict[str, list[str]] = {}

def snapshot_key(dep: str, ver: str) -> str:
    base = ver.split("(", 1)[0]
    return ver if "@" in base[1:] else f"{dep}@{ver}"

section = cur_key = cur_sub = cur_dep = None
with open("pnpm-lock.yaml", encoding="utf-8", errors="replace") as f:
    for line in f:
        line = line.rstrip("\r\n")
        if line and not line.startswith(" "):
            section = line.rstrip(":")
            cur_key = cur_sub = cur_dep = None
            continue
        if section == "importers":
            if line.startswith("  ") and not line.startswith("   "):
                cur_sub = cur_dep = None
                if line.endswith(":"):
                    cur_key = line.strip()[:-1].strip(Q)
                    importers.setdefault(cur_key, {})
                else:
                    cur_key = None
            elif cur_key and line.startswith("    ") and not line.startswith("     "):
                cur_dep = None
                cur_sub = line.strip()[:-1] if line.endswith(":") else None
            elif cur_key and cur_sub in ("dependencies", "devDependencies", "optionalDependencies"):
                if line.startswith("      ") and not line.startswith("       "):
                    cur_dep = line.strip()[:-1].strip(Q) if line.endswith(":") else None
                elif cur_dep and line.startswith("        version: "):
                    importers[cur_key][cur_dep] = line.split("version: ", 1)[1].strip().strip(Q)
        elif section == "snapshots":
            if line.startswith("  ") and not line.startswith("   "):
                cur_sub = None
                if line.endswith(":"):
                    cur_key = line.strip()[:-1].strip(Q)
                    snapshots.setdefault(cur_key, [])
                else:
                    cur_key = None
            elif cur_key and line.startswith("    ") and not line.startswith("     "):
                cur_sub = line.strip()[:-1] if line.endswith(":") else None
            elif cur_key and cur_sub in ("dependencies", "optionalDependencies") and line.startswith("      ") and ":" in line:
                k, v = line.strip().split(":", 1)
                snapshots[cur_key].append(snapshot_key(k.strip(Q), v.strip().strip(Q)))

if "apps/mobile" not in importers:
    emit_fallback()
    raise SystemExit(0)

# Hash non-dependency metadata from apps/mobile/package.json (name, version, main, expo, etc.).
try:
    with open("apps/mobile/package.json", encoding="utf-8") as f:
        pkg_meta = json.load(f)
    for dep_field in ("dependencies", "devDependencies", "optionalDependencies"):
        pkg_meta.pop(dep_field, None)
    meta_json = json.dumps(pkg_meta, sort_keys=True, separators=(",", ":"))
    print(f"mobile-pkg-meta:{hashlib.sha256(meta_json.encode()).hexdigest()}")
except Exception:
    emit_fallback()
    raise SystemExit(0)

visited_importers: set[str] = set()
visited_pkgs: set[str] = set()
imp_queue = [k for k in importers if k == "apps/mobile" or k.startswith("apps/mobile/")]
pkg_queue: list[str] = []
while imp_queue:
    imp = imp_queue.pop()
    if imp in visited_importers or imp not in importers:
        continue
    visited_importers.add(imp)
    for dep, ver in importers[imp].items():
        if ver.startswith("link:"):
            target = posixpath.normpath(posixpath.join(imp, ver[5:]))
            if target == "apps/mobile" or target.startswith("apps/mobile/"):
                imp_queue.append(target)
        else:
            pkg_queue.append(snapshot_key(dep, ver))

while pkg_queue:
    pkg = pkg_queue.pop()
    if pkg in visited_pkgs:
        continue
    visited_pkgs.add(pkg)
    for child in snapshots.get(pkg, ()):
        if child not in visited_pkgs:
            pkg_queue.append(child)

pnpm_entries: dict[str, list[str]] = {}
if os.path.isdir("node_modules/.pnpm"):
    for entry in os.listdir("node_modules/.pnpm"):
        m = re.match(r"^((?:@[^+]+\+)?[^@]+)@", entry)
        if m:
            raw = m.group(1)
            name = raw.replace("+", "/", 1) if raw.startswith("@") else raw
            pnpm_entries.setdefault(name, []).append(
                os.path.join("node_modules/.pnpm", entry, "node_modules", name)
            )

markers = (
    "expo-module.config.json",
    "react-native.config.js",
    "react-native.config.cjs",
    "app.plugin.js",
    "app.plugin.cjs",
    "app.plugin.ts",
    "ios",
    "plugin",
)

def is_native_or_plugin(name: str) -> bool:
    if name in ("expo", "react-native") or name.startswith("@expo/"):
        return True
    dirs = list(pnpm_entries.get(name, ()))
    direct = os.path.join("apps/mobile/node_modules", name)
    if os.path.isdir(direct):
        dirs.append(direct)
    if not dirs:
        return True
    for pkg_dir in dirs:
        if not os.path.isdir(pkg_dir):
            return True
        if any(os.path.exists(os.path.join(pkg_dir, marker)) for marker in markers):
            return True
        try:
            if any(entry.endswith(".podspec") for entry in os.listdir(pkg_dir)):
                return True
        except OSError:
            return True
    return False

native_names: set[str] = set()
for key in sorted(visited_pkgs):
    at = key.find("@", 1)
    name = key[:at] if at > 0 else key
    if is_native_or_plugin(name):
        native_names.add(name)
        print(f"native-pkg:{key}")

if os.path.isdir("patches"):
    for fname in sorted(os.listdir("patches")):
        fpath = os.path.join("patches", fname)
        if not os.path.isfile(fpath) or not fname.endswith(".patch"):
            continue
        stem = urllib.parse.unquote(fname[:-6])
        at = stem.rfind("@")
        raw_name = stem[:at] if at > 0 else stem
        pkg_name = raw_name
        if pkg_name.startswith("@") and "/" not in pkg_name:
            pkg_name = pkg_name.replace("__", "/", 1) if "__" in pkg_name else pkg_name.replace("+", "/", 1)
        if at <= 0 or pkg_name in native_names:
            print(f"native-patch:{fname}:{sha256_file(fpath)}")
PY
}

prebuild_fingerprint() {
  local extra_files=() roots=()
  local candidate
  for candidate in apps/mobile/fingerprint.config.js scripts/lib/brand-assets.ts scripts/lib/public-config.ts .env .env.local; do
    [ -f "$candidate" ] && extra_files+=("$candidate")
  done
  for candidate in apps/mobile/plugins apps/mobile/modules apps/mobile/assets assets/dev; do
    [ -d "$candidate" ] && roots+=("$candidate")
  done
  {
    printf 'env:%s:%s:%s:%s:%s:%s:%s\n' \
      "$APP_VARIANT" \
      "$T3CODE_IOS_PERSONAL_TEAM" \
      "$T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID" \
      "$T3CODE_MOBILE_APP_NAME" \
      "$T3CODE_MOBILE_SCHEME" \
      "$T3CODE_MOBILE_UPDATES_ENABLED" \
      "$team_id"
    shasum -a 256 apps/mobile/app.config.ts \
      ${extra_files[@]+"${extra_files[@]}"}
    mobile_native_deps_digest
    if [ "${#roots[@]}" -gt 0 ]; then
      # Match regular files and file symlinks (e.g. AppleSpeechEngine.swift -> native/apple-speech/)
      # without descending into directory symlinks, avoiding symlink loops.
      find "${roots[@]}" \
        -type d \( -name node_modules -o -name build -o -name .build -o -name Pods \) -prune \
        -o \( -type f -o -type l \) -print \
        | LC_ALL=C sort \
        | while IFS= read -r path; do
          if [ -f "$path" ]; then
            printf '%s\0' "$path"
          fi
        done \
        | xargs -0 shasum -a 256
    fi
  } | shasum -a 256 | awk '{ print $1 }'
}

# Moves cached provisioning profiles for this exact app ID aside so xcodebuild
# fetches a fresh 7-day Personal Team profile; restored automatically on failure.
profile_backup_dir=""
restore_profile_backup() {
  [ -n "$profile_backup_dir" ] && [ -d "$profile_backup_dir" ] || return 0
  local entry dest_dir restore_failed=0
  for entry in "$profile_backup_dir"/*.mobileprovision; do
    [ -f "$entry" ] || continue
    dest_dir="$(cat "$entry.dir" 2>/dev/null || true)"
    if [ -n "$dest_dir" ] && mkdir -p "$dest_dir" && mv "$entry" "$dest_dir/$(basename "$entry")"; then
      rm -f "$entry.dir"
    else
      restore_failed=1
    fi
  done
  if [ "$restore_failed" = 0 ]; then
    rm -rf "$profile_backup_dir"
  else
    rmdir "$profile_backup_dir" 2>/dev/null || true
    echo "build-ios: warning: could not restore all stashed profiles from $profile_backup_dir" >&2
  fi
  profile_backup_dir=""
}
trap restore_profile_backup EXIT

stash_cached_profiles() {
  local app_id="${team_id}.${T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID}" dir file xml found_id
  for dir in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" "$HOME/Library/MobileDevice/Provisioning Profiles"; do
    [ -d "$dir" ] || continue
    for file in "$dir"/*.mobileprovision; do
      [ -f "$file" ] || continue
      xml="$(security cms -D -i "$file" 2>/dev/null || true)"
      found_id="$(plutil -extract Entitlements.application-identifier raw - <<<"$xml" 2>/dev/null || true)"
      if [ "$found_id" = "$app_id" ]; then
        if [ -z "$profile_backup_dir" ]; then
          profile_backup_dir="$(mktemp -d "$FORK_STATE_DIR/profile-backup.XXXXXX")"
        fi
        printf '%s\n' "$dir" >"$profile_backup_dir/$(basename "$file").dir"
        mv "$file" "$profile_backup_dir/$(basename "$file")"
        echo "build-ios: stashed cached profile $(basename "$file") for renewal"
      fi
    done
  done
}

# Syncs run in a scratch worktree; ensure local node_modules match the lockfile.
if [ ! -f node_modules/.modules.yaml ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
  vp install --frozen-lockfile
fi

commit="$(git rev-parse HEAD)"
fingerprint="$(prebuild_fingerprint)"
stamp_file="apps/mobile/ios/.fork-prebuild.sha256"
workspace="apps/mobile/ios/T3CodeFork.xcworkspace"
if [ "$clean_prebuild" = 0 ] && [ -d "$workspace" ] && [ -f "apps/mobile/ios/Pods/Manifest.lock" ] &&
  [ "$(cat "$stamp_file" 2>/dev/null || true)" = "$fingerprint" ]; then
  echo "build-ios: reusing cached prebuild (${fingerprint:0:12})"
else
  echo "build-ios: prebuilding $T3CODE_MOBILE_APP_NAME ($T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID, team ${team_id:-none})"
  # Leave DEVELOPMENT_TEAM unset during prebuild so signing configures cleanly
  # with DEVELOPMENT_TEAM / T3CODE_IOS_TEAM_ID and provisioning updates.
  (cd apps/mobile && T3CODE_IOS_TEAM_ID="" vp exec expo prebuild --clean --platform ios)
  printf '%s\n' "$fingerprint" >"$stamp_file"
fi

# Interactive Debug or Simulator runs stay on expo run:ios (supports Metro dev client).
if [ "$mode" = "simulator" ] || { [ "$mode" = "device" ] && [ "$configuration" = "Debug" ]; }; then
  run_args=(--configuration "$configuration")
  if [ "$configuration" = "Release" ]; then
    run_args+=(--no-bundler)
  fi
  if [ "$mode" = "device" ]; then
    run_args+=(--device "$device_udid")
  elif [ -n "$target" ]; then
    run_args+=(--device "$target")
  fi
  echo "build-ios: building and installing ($mode, $configuration)"
  (cd apps/mobile && T3CODE_IOS_TEAM_ID="$team_id" vp exec expo run:ios "${run_args[@]}")
  exit 0
fi

# Release device / stage build: build directly via xcodebuild into persistent DerivedData
# and stage the signed .app bundle atomically so build and wireless install stay decoupled.
if [ "$renew_profile" = 1 ]; then
  stash_cached_profiles
fi

xcode_log="$FORK_STATE_DIR/logs/ios-xcodebuild.log"
mkdir -p "$(dirname "$xcode_log")" "$FORK_IOS_DERIVED_DATA"
echo "build-ios: compiling Release arm64 bundle (team $team_id; log: $xcode_log)"
# Match Expo's bundle phase expectation so Node resolves in launchd's bare PATH.
export NODE_BINARY="${NODE_BINARY:-$(command -v node)}"
# Redirect xcodebuild to a regular file so resident Xcode daemons (SWBBuildService) never inherit
# a caller's log pipe and block exit, and to keep update.log free of compiler warning noise.
if ! xcodebuild \
  -quiet \
  -workspace "$workspace" \
  -scheme T3CodeFork \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$FORK_IOS_DERIVED_DATA" \
  DEVELOPMENT_TEAM="$team_id" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build </dev/null >"$xcode_log" 2>&1; then
  tail -n 80 "$xcode_log" >&2 || true
  echo "build-ios: xcodebuild failed; full log in $xcode_log" >&2
  exit 1
fi

# Build succeeded; discard any stashed stale profile backup.
if [ -n "$profile_backup_dir" ]; then
  rm -rf "$profile_backup_dir"
  profile_backup_dir=""
fi

built_app="$FORK_IOS_DERIVED_DATA/Build/Products/Release-iphoneos/T3CodeFork.app"
if [ ! -d "$built_app" ]; then
  echo "build-ios: expected signed bundle at $built_app" >&2
  exit 1
fi

built_at="$(date +%s)"
version="$(plutil -extract CFBundleShortVersionString raw "$built_app/Info.plist" 2>/dev/null || true)"
profile_expires="$(fork_ios_profile_expires "$built_app")"

incoming="$FORK_IOS_STAGED_APP.incoming"
mkdir -p "$FORK_IOS_STAGED_DIR"
rm -rf "$incoming"
ditto "$built_app" "$incoming"
rm -rf "$FORK_IOS_STAGED_APP"
mv "$incoming" "$FORK_IOS_STAGED_APP"
fork_ios_meta_write "$FORK_IOS_STAGED_META" \
  "commit=$commit" \
  "version=$version" \
  "built_at=$built_at" \
  "profile_expires=$profile_expires" \
  "team_id=$team_id" \
  "bundle_id=$T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID"
echo "build-ios: staged $FORK_IOS_STAGED_APP (${commit:0:10}, expires ${profile_expires:-unknown})"

if [ "$mode" = "stage" ]; then
  exit 0
fi

echo "build-ios: installing onto device $device_udid"
xcrun devicectl device install app --timeout 120 --device "$device_udid" "$FORK_IOS_STAGED_APP"
installed_at="$(date +%s)"
fork_ios_meta_write "$FORK_IOS_INSTALLED_META" \
  "device=$device_udid" \
  "commit=$commit" \
  "version=$version" \
  "built_at=$built_at" \
  "profile_expires=$profile_expires" \
  "installed_at=$installed_at"
rm -f "$FORK_STATE_DIR/ios-expiry-warned"
echo "build-ios: installed ${commit:0:10} on $device_udid"
