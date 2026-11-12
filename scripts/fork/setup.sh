#!/usr/bin/env bash
# One-time setup of the fork app on this Mac. Safe to run again: it keeps what
# exists. See FORK.md.
#   1. A signing identity in a keychain of its own (config.sh: FORK_KEYCHAIN).
#   2. The fork's T3 home, marked so the app leaves the `t3` command alone.
#   3. The launchd job that runs update.sh every hour from this checkout.
#
# Usage: scripts/fork/setup.sh [--no-job]
#   --no-job  skip step 3, for a checkout that only builds
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

if [ ! -f "$FORK_KEYCHAIN" ]; then
  signing="$(dirname "$FORK_KEYCHAIN")"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  (
    umask 077
    mkdir -p "$signing"
    /usr/bin/openssl rand -hex 24 >"$FORK_KEYCHAIN_PASSWORD_FILE"
  )
  password="$(cat "$FORK_KEYCHAIN_PASSWORD_FILE")"
  cat >"$work/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $FORK_SIGN_IDENTITY
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
  # The system LibreSSL writes a PKCS#12 file that `security import` reads.
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/cert.cnf" \
    -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
  /usr/bin/openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" \
    -name "$FORK_SIGN_IDENTITY" -out "$work/identity.p12" -passout "pass:$password"
  security create-keychain -p "$password" "$FORK_KEYCHAIN"
  # No lock timeout; build-app.sh unlocks it after a restart.
  security set-keychain-settings "$FORK_KEYCHAIN"
  security unlock-keychain -p "$password" "$FORK_KEYCHAIN"
  security import "$work/identity.p12" -k "$FORK_KEYCHAIN" -P "$password" -T /usr/bin/codesign >/dev/null
  # Lets codesign use the key without a confirmation dialog.
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$FORK_KEYCHAIN" >/dev/null
  echo "setup: created the signing identity in $FORK_KEYCHAIN"
fi

mkdir -p "$FORK_T3_HOME/userdata"
# The app installs a `t3` command on its first launch unless this file exists.
touch "$FORK_T3_HOME/userdata/cli-command-first-launch"

if [ "${1:-}" != "--no-job" ]; then
  plist="$HOME/Library/LaunchAgents/$FORK_LAUNCHD_LABEL.plist"
  mkdir -p "$FORK_STATE_DIR/logs"
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
