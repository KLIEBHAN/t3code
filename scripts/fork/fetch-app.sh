#!/usr/bin/env bash
# Fetches the build host's newest fork app into FORK_STAGED_APP, on a Mac that
# installs builds another Mac makes (setup.sh --build-host). update.sh installs
# it from there. Both Macs need the same home folder path: this script reads
# the build host's app from the paths config.sh gives. See FORK.md.
#
# Usage: scripts/fork/fetch-app.sh [--commit]
#   --commit  only print the commit of the build host's newest app; nothing
#             when the build host is not reachable
# Exit codes: 0 fetched, already current, or the build host is not reachable;
# 1 the build host has no app, the copy failed, or its signature is invalid;
# 2 no build host configured.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

if [ -z "$FORK_BUILD_HOST" ]; then
  echo "fetch: no build host configured; see FORK.md" >&2
  exit 2
fi

ssh_options=(-o BatchMode=yes -o ConnectTimeout=5)

# The build host's waiting build if it has one, otherwise its installed app.
# Prints the path, then the commit.
probe="for app in \"$FORK_STAGED_APP\" \"$FORK_APP_PATH\"; do
  if [ -d \"\$app\" ]; then
    echo \"\$app\"
    plutil -extract T3ForkCommit raw \"\$app/Contents/Info.plist\"
    exit 0
  fi
done
exit 3"

status=0
found="$(ssh "${ssh_options[@]}" "$FORK_BUILD_HOST" "$probe" </dev/null 2>/dev/null)" || status=$?
case "$status" in
  0) ;;
  # ssh itself failed: away from the build host's network, or it is off.
  255) exit 0 ;;
  *)
    echo "fetch: $FORK_BUILD_HOST has no fork app" >&2
    exit 1
    ;;
esac
remote_app="$(sed -n 1p <<<"$found")"
commit="$(sed -n 2p <<<"$found")"
if [ "${1:-}" = "--commit" ]; then
  echo "$commit"
  exit 0
fi
if [ "$commit" = "$(fork_app_commit "$FORK_STAGED_APP")" ] || [ "$commit" = "$(fork_app_commit "$FORK_APP_PATH")" ]; then
  exit 0
fi

echo "fetch: ${commit:0:10} from $FORK_BUILD_HOST"
incoming="$FORK_STATE_DIR/incoming/$FORK_APP_NAME.app"
rm -rf "$incoming"
mkdir -p "$incoming"
rsync_options=(-a --delete -e "ssh ${ssh_options[*]}")
# What the installed app already has is taken from it, not from the network.
[ ! -d "$FORK_APP_PATH" ] || rsync_options+=(--copy-dest="$FORK_APP_PATH")
if ! rsync "${rsync_options[@]}" "$FORK_BUILD_HOST:$(printf '%q' "$remote_app")/" "$incoming/"; then
  rm -rf "$incoming"
  echo "fetch: the copy from $FORK_BUILD_HOST failed" >&2
  exit 1
fi
# The build host may have replaced its app during the copy.
if [ "$(fork_app_commit "$incoming")" != "$commit" ] || ! codesign --verify --deep --strict "$incoming" 2>/dev/null; then
  rm -rf "$incoming"
  echo "fetch: the copy is incomplete or its signature is invalid" >&2
  exit 1
fi

rm -rf "$FORK_STAGED_APP"
mkdir -p "$(dirname "$FORK_STAGED_APP")"
mv "$incoming" "$FORK_STAGED_APP"
echo "fetch: staged $FORK_STAGED_APP"
