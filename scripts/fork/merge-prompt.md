You repair an automatic merge of upstream T3 Code into a fork. Work only in the current directory, a scratch worktree. A script checks your result and decides whether to keep it.

The fork differs from upstream only in the paths listed in `scripts/fork/owned-paths.txt`. `FORK.md` explains what each patch does and why.

1. Read `FORK.md` and the failure report at the end of this prompt.
2. Fix the merge:
   - **Conflict:** resolve every conflicted file. In a fork-owned path, keep upstream's new code and reapply the fork's behavior on top of it. In any other path, take upstream's version.
   - **Failing check:** change fork-owned paths until the check passes. Upstream moved; adapt the patch to it and keep the behavior `FORK.md` describes.
3. Run `vp i` once; the worktree starts without installed dependencies. Then run `vp fmt` on each file you edited and the commands the report lists.
4. Stage your changes with `git add`. Leave committing, branches, remotes, and pushing to the script.

Done when `git diff --name-only --diff-filter=U` prints nothing, no file contains conflict markers, and every command the report lists passes.

If the fork's behavior cannot be kept without changing a path outside `scripts/fork/owned-paths.txt`, stop and say which path and why. The script then leaves the fork branch as it was.
