#!/usr/bin/env bash
# Merges the newest upstream nightly tag into the fork branch and pushes it.
# The merge runs in a scratch worktree; the fork branch moves only after the
# result passes verify(). A conflict or failed verification gets one repair
# attempt by a model (merge-prompt.md). See FORK.md.
#
# Usage: scripts/fork/sync-upstream.sh [--no-push] [--no-assist]
# Exit codes: 0 merged or already current, 1 failed with the fork branch
# untouched, 2 wrong checkout state. A failed attempt stays in the scratch
# worktree until the next run.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/fork/config.sh

push=1
assist=1
for arg in "$@"; do
  case "$arg" in
    --no-push) push=0 ;;
    --no-assist) assist=0 ;;
    *)
      echo "sync: unknown argument $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$(git branch --show-current)" != "$FORK_BRANCH" ]; then
  echo "sync: check out $FORK_BRANCH first" >&2
  exit 2
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "sync: uncommitted changes, nothing merged" >&2
  exit 2
fi

# Pushes the branch when origin lacks its head, which also retries a push that failed in an earlier run.
publish() {
  [ "$push" = 1 ] || return 0
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse -q --verify "refs/remotes/origin/$FORK_BRANCH" || true)" ]; then
    git push --quiet origin "$FORK_BRANCH" || echo "sync: the push to origin failed; the next run retries it" >&2
  fi
}

git fetch --quiet --no-tags upstream '+refs/tags/*:refs/tags/*'
tag="$(git tag --list 'v*-nightly.*' --sort=-creatordate | head -n 1)"
if [ -z "$tag" ]; then
  echo "sync: no upstream nightly tag found" >&2
  exit 1
fi
if git merge-base --is-ancestor "$tag" HEAD; then
  echo "sync: $FORK_BRANCH already contains $tag"
  publish
  exit 0
fi

checkout="$PWD"
worktree="$FORK_STATE_DIR/sync-worktree"
report="$FORK_STATE_DIR/sync-report.txt"
# Read before the merge, so a repair cannot widen what the fork may change.
owned_paths="$(git show "$FORK_BRANCH:scripts/fork/owned-paths.txt")"
check_commands='vp i
vp test run packages/provider-pi/src/server/adapter.test.ts apps/desktop/src/app/DesktopUserData.test.ts
vp run --filter @t3tools/provider-pi --filter @t3tools/desktop typecheck'

mkdir -p "$FORK_STATE_DIR"
git worktree remove --force "$worktree" 2>/dev/null || true
git worktree prune
git worktree add --quiet --detach "$worktree" "$FORK_BRANCH"
cd "$worktree"

fail() {
  echo "sync: $1; the attempt is in $worktree, the report in $report" >&2
  exit 1
}

# Paths that differ from the upstream tag without being fork-owned.
foreign_paths() {
  local path pattern owned
  git diff --name-only "$tag" HEAD | while IFS= read -r path; do
    owned=0
    while IFS= read -r pattern; do
      case "$pattern" in '' | '#'*) continue ;; esac
      if [ "$path" = "$pattern" ] || { [[ $pattern == */ ]] && [[ $path == "$pattern"* ]]; }; then
        owned=1
        break
      fi
    done <<<"$owned_paths"
    [ "$owned" = 1 ] || echo "$path"
  done
}

# The merge is acceptable: only fork-owned paths differ from the tag, and the
# checks pass. Writes the reason to $report otherwise.
verify() {
  local foreign
  foreign="$(foreign_paths)"
  if [ -n "$foreign" ]; then
    printf 'The merge differs from %s outside the fork-owned paths:\n%s\n' "$tag" "$foreign" >"$report"
    return 1
  fi
  local command
  while IFS= read -r command; do
    if ! bash -c "$command" </dev/null >"$report.out" 2>&1; then
      {
        printf 'This command failed:\n%s\n\nIts last output:\n' "$command"
        tail -n 120 "$report.out"
      } >"$report"
      return 1
    fi
  done <<<"$check_commands"
  rm -f "$report" "$report.out"
}

# One model run per sync. It edits and stages; this function commits.
repair() {
  [ "$assist" = 1 ] || return 1
  assist=0
  echo "sync: asking the model to repair: $1"
  local prompt
  prompt="$(cat "$checkout/scripts/fork/merge-prompt.md")

## Failure report

Upstream tag: $tag
$1

$(cat "$report")

After your fix these commands must pass:
$check_commands"
  if ! perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$FORK_MERGE_TIMEOUT_SECONDS" \
    pi --print --no-session --no-context-files --no-skills "${FORK_MERGE_PI_ARGS[@]}" "$prompt" </dev/null; then
    echo "sync: the model run failed or timed out" >&2
    return 1
  fi
  git add -A
  local path
  while IFS= read -r path; do
    if [ -f "$path" ] && grep -qE '^(<<<<<<<|>>>>>>>) ' "$path"; then
      echo "sync: $path still has conflict markers" >&2
      return 1
    fi
  done <<<"$conflicted"
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    git commit --quiet --no-verify --no-edit || return 1
  elif ! git diff --cached --quiet; then
    git commit --quiet --no-verify -m "fix(fork): adapt the fork patches to upstream $tag" || return 1
  fi
}

echo "sync: merging $tag"
conflicted=""
if ! git merge --quiet --no-edit -m "Merge upstream $tag into $FORK_BRANCH" "$tag" >"$report" 2>&1; then
  conflicted="$(git diff --name-only --diff-filter=U)"
  printf '\nConflicted files:\n%s\n' "$conflicted" >>"$report"
  repair "The merge stopped with conflicts." || fail "conflict merging $tag"
fi
if ! verify; then
  repair "The merge went through, but verification failed." || fail "verification failed after merging $tag"
  verify || fail "verification still fails after the repair"
fi

merged="$(git rev-parse HEAD)"
cd "$checkout"
git merge --quiet --ff-only "$merged"
git worktree remove --force "$worktree"
publish
echo "sync: $FORK_BRANCH now contains $tag"
