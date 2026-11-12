# Settings shared by the fork scripts. Source it from the repository root; see FORK.md.
# shellcheck shell=bash

FORK_BRANCH=pi-prompt-suggestions
FORK_APP_NAME="T3 Code (Fork)"
FORK_BUNDLE_ID=com.kliebhan.t3code-fork
# Electron's app name. Its keychain entry is "<name> Safe Storage".
FORK_PACKAGE_NAME=t3code-fork
FORK_APP_PATH="/Applications/$FORK_APP_NAME.app"
# T3 home of the fork app. The official app keeps ~/.t3.
FORK_T3_HOME="$HOME/.t3-fork"
# Build output, the staged app, logs, and the signing keychain.
FORK_STATE_DIR="${FORK_STATE_DIR:-$HOME/workspace/t3code-fork-build}"
FORK_STAGED_APP="$FORK_STATE_DIR/staged/$FORK_APP_NAME.app"
FORK_SIGN_IDENTITY="T3 Code Fork Local Signing"
FORK_KEYCHAIN="$FORK_STATE_DIR/signing/fork.keychain-db"
FORK_KEYCHAIN_PASSWORD_FILE="$FORK_STATE_DIR/signing/keychain-password"
FORK_LAUNCHD_LABEL=com.kliebhan.t3code-fork.update
# Pi arguments for the model that repairs a failed merge.
FORK_MERGE_PI_ARGS=(
  --no-extensions -e "$HOME/.pi/agent/extensions/cpa.ts"
  --model "${FORK_MERGE_MODEL:-cpa/claude-opus-5-5}" --thinking high
)
FORK_MERGE_TIMEOUT_SECONDS=1800

# launchd starts jobs with a bare PATH.
PATH="$HOME/.cargo/bin:$HOME/.pi/agent/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
# Vite+ provides vp and the Node version the repository pins.
# shellcheck source=/dev/null
. "${VP_ENV:-$HOME/workspace/t3code-fork-toolchain/vite-plus/env}"
export PATH

# The commit an app bundle was built from, or nothing when the bundle is missing.
fork_app_commit() {
  plutil -extract T3ForkCommit raw "$1/Contents/Info.plist" 2>/dev/null || true
}

fork_app_running() {
  # pgrep takes a regular expression, and the app name has parentheses. -a also
  # matches ancestors, for a run started from a terminal inside the app.
  pgrep -a -f "$(printf '%s' "$FORK_APP_PATH/Contents/MacOS/" | sed 's/[][().*+?^$|{}\\]/\\&/g')" >/dev/null
}
