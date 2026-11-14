#!/usr/bin/env bash
# Builds the Dock applet's icon into scripts/fork/applet-icon/ from upstream's
# Icon Composer icon (assets/dev/app-icon.icon) with the update badge on top.
# Needs Xcode (swift, actool). Run it only to change the look and commit the
# result: install-applet.sh copies the files, so receiving Macs need no Xcode.
#
# Usage: scripts/fork/make-applet-icon.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

icon="$work/AppIcon.icon"
cp -R assets/dev/app-icon.icon "$icon"
swift scripts/fork/applet-icon.swift "$icon/Assets/badge.png"
# The badge goes into a group of its own above upstream's layers, without glass.
python3 - "$icon/icon.json" <<'PY'
import json, sys
path = sys.argv[1]
icon = json.load(open(path))
badge = {"layers": [{"glass": False, "image-name": "badge.png", "name": "Badge"}], "shadow": {"kind": "neutral", "opacity": 0.4}}
icon["groups"].insert(0, badge)
json.dump(icon, open(path, "w"), indent=2)
PY

mkdir -p "$work/out"
xcrun actool --compile "$work/out" --platform macosx --minimum-deployment-target 12.0 \
  --app-icon AppIcon --output-partial-info-plist "$work/partial.plist" "$icon" >/dev/null
out=scripts/fork/applet-icon
mkdir -p "$out"
cp "$work/out/Assets.car" "$work/out/AppIcon.icns" "$out/"
echo "icon: wrote $out/Assets.car and $out/AppIcon.icns"
