#!/usr/bin/env bash
# Merges the newest upstream nightly tag into the fork branch, checks the Pi
# patch, and pushes the branch to the fork. See FORK.md.
#
# Usage: scripts/fork/sync-upstream.sh [--no-push]
# Exit codes: 0 synced or already current, 1 merge conflict or failed check,
# 2 wrong checkout state. A failed attempt stays on branch `fork-sync`.
set -euo pipefail

BRANCH=pi-prompt-suggestions
SCRATCH=fork-sync
VP_ENV="${VP_ENV:-$HOME/workspace/t3code-fork-toolchain/vite-plus/env}"
push=1
[ "${1:-}" = "--no-push" ] && push=0

cd "$(git rev-parse --show-toplevel)"
if [ "$(git branch --show-current)" != "$BRANCH" ]; then
  echo "sync: check out $BRANCH first" >&2
  exit 2
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "sync: uncommitted changes, nothing merged" >&2
  exit 2
fi

git fetch --quiet upstream --tags
tag="$(git tag --list 'v*-nightly.*' --sort=-creatordate | head -n 1)"
if [ -z "$tag" ]; then
  echo "sync: no upstream nightly tag found" >&2
  exit 1
fi
if git merge-base --is-ancestor "$tag" HEAD; then
  echo "sync: $BRANCH already contains $tag"
  exit 0
fi

echo "sync: merging $tag"
git switch --quiet -C "$SCRATCH" "$BRANCH"
if ! git merge --quiet --no-edit -m "Merge upstream $tag into $BRANCH" "$tag"; then
  git merge --abort
  git switch --quiet "$BRANCH"
  echo "sync: conflict merging $tag; resolve it by hand (see FORK.md)" >&2
  exit 1
fi

# shellcheck source=/dev/null
. "$VP_ENV"
check() {
  vp i &&
    vp test run packages/provider-pi/src/server/adapter.test.ts &&
    vp run --filter @t3tools/provider-pi typecheck
}
if ! check; then
  git switch --quiet "$BRANCH"
  echo "sync: checks failed after merging $tag; the merge is on branch $SCRATCH" >&2
  exit 1
fi

git switch --quiet "$BRANCH"
git merge --quiet --ff-only "$SCRATCH"
git branch --quiet -d "$SCRATCH"
if [ "$push" = 1 ]; then
  git push --quiet origin "$BRANCH"
fi
echo "sync: $BRANCH now contains $tag"
