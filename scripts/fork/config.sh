# Settings shared by the fork scripts. Source it from the repository root; see FORK.md.
# shellcheck shell=bash

FORK_BRANCH=pi-prompt-suggestions
FORK_APP_NAME="T3 Code (Fork)"
FORK_BUNDLE_ID=com.kliebhan.t3code-fork
FORK_APP_PATH="/Applications/$FORK_APP_NAME.app"
# Build output, the staged app, and logs.
FORK_STATE_DIR="${FORK_STATE_DIR:-$HOME/workspace/t3code-fork-build}"
FORK_STAGED_APP="$FORK_STATE_DIR/staged/$FORK_APP_NAME.app"
# An Apple-issued identity from the login keychain. macOS ties the app's keychain
# and privacy grants to its team, so they survive every rebuild.
FORK_SIGN_IDENTITY="${FORK_SIGN_IDENTITY:-Apple Development: fabian.kliebhan@gmail.com (7VHQ3DW64R)}"
FORK_LAUNCHD_LABEL=com.kliebhan.t3code-fork.update
# Set on a Mac that installs another Mac's builds instead of making its own:
# the SSH host it fetches the app from. Stored in this checkout's git config.
FORK_BUILD_HOST="${FORK_BUILD_HOST:-$(git config --get fork.buildHost || true)}"
# Pi arguments for the model that repairs a failed merge.
FORK_MERGE_PI_ARGS=(
  --no-extensions -e "$HOME/.pi/agent/extensions/cpa.ts"
  --model "${FORK_MERGE_MODEL:-cpa/claude-opus-5-5}" --thinking high
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
