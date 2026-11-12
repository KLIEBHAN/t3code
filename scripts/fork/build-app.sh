#!/usr/bin/env bash
# Builds the fork's macOS app from the current commit and leaves it signed at
# FORK_STAGED_APP (see config.sh). It installs nothing. See FORK.md.
#
# Usage: scripts/fork/build-app.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "build: uncommitted changes; the app records the commit it was built from" >&2
  exit 2
fi
if ! security find-identity -v -p codesigning | grep -F "\"$FORK_SIGN_IDENTITY\"" >/dev/null; then
  echo "build: no valid signing identity \"$FORK_SIGN_IDENTITY\" in the keychain; see FORK.md" >&2
  exit 2
fi

commit="$(git rev-parse HEAD)"
tag="$(git describe --tags --match 'v*-nightly.*' --abbrev=0)"
version="${tag#v}"
out="$FORK_STATE_DIR/build-out"
rm -rf "$out"

echo "build: $version at ${commit:0:10}"
# A sync installs only in its scratch worktree, and upstream may have changed the lockfile.
vp i
# Builds outside pingdotgg/t3code report as dev, as upstream's release workflow does.
T3CODE_TELEMETRY_CHANNEL=dev T3CODE_DESKTOP_VERSION="$version" \
  node scripts/build-desktop-artifact.ts --platform mac --target dir --arch arm64 --output-dir "$out"

built=("$out"/mac-arm64/*.app)
if [ "${#built[@]}" != 1 ] || [ ! -d "${built[0]}" ]; then
  echo "build: expected one app bundle in $out/mac-arm64" >&2
  exit 1
fi
app="$out/mac-arm64/$FORK_APP_NAME.app"
mv "${built[0]}" "$app"

# An identity of its own, so macOS tells it apart from the official app. It
# uses the official app's data all the same: T3 home, browser profile, and
# keychain entry come from upstream's code, which this leaves alone. Without
# the URL and document types it never takes t3code:// or web links from the
# official app. CFBundleName stays: Electron finds its helper apps by that name.
plist="$app/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "$FORK_BUNDLE_ID" "$plist"
plutil -replace CFBundleDisplayName -string "$FORK_APP_NAME" "$plist"
plutil -remove CFBundleURLTypes "$plist"
plutil -remove CFBundleDocumentTypes "$plist"
plutil -insert T3ForkCommit -string "$commit" "$plist"

# Upstream's dev icon tells the two apps apart in the Dock.
iconset="$out/fork.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" assets/dev/blueprint-macos-1024.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" assets/dev/blueprint-macos-1024.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/icon.icns"

# No secure timestamp: it needs Apple's server, and only notarization requires it.
codesign --force --deep --timestamp=none --sign "$FORK_SIGN_IDENTITY" "$app"
codesign --verify --deep --strict "$app"

rm -rf "$FORK_STAGED_APP"
mkdir -p "$(dirname "$FORK_STAGED_APP")"
mv "$app" "$FORK_STAGED_APP"
rm -rf "$out"
echo "build: staged $FORK_STAGED_APP"
