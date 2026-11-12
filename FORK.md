# Fork: Pi prompt suggestions

This fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) adds one feature: **Suggest next prompt** (Settings > Labs) works for Pi threads as well as Claude and Codex threads. Branch `pi-prompt-suggestions` follows the upstream nightly tags. It builds a macOS app, **T3 Code (Fork)**, that runs beside the official app.

## Patches

The fork differs from upstream only in the paths listed in `scripts/fork/owned-paths.txt`. Each change to upstream code is marked `Fork:` or covered by a test named below.

- **Pi suggestions** (`packages/provider-pi/src/server/adapter.ts`): upstream's Pi adapter ignores the `set_editor_text` call that Pi extensions use to prefill the input. After a completed turn the fork turns that call into the `prompt_suggestion.updated` event Claude and Codex emit, under the same rules: the Labs setting is on, no turn is running, and the thread is not delegated. Test: `offers extension editor text after a completed turn as the next prompt`.
- **Own browser profile** (`apps/desktop/src/app/DesktopUserData.ts`): on macOS, with a T3 home other than `~/.t3`, the app keeps its Chromium profile in `<T3 home>/desktop-profile`. Upstream uses one fixed profile, which also holds the single-instance lock, so a second app could not start. Test: `keeps a separate profile on macOS for a T3 home other than ~/.t3`.
- **Own app name** (`scripts/build-desktop-artifact.ts`): `T3CODE_DESKTOP_PACKAGE_NAME` sets Electron's app name. Electron keeps its encryption key in the keychain entry `<name> Safe Storage`; with upstream's name the fork app would ask for the official app's entry and macOS would show a keychain dialog.

The suggestion text comes from the Pi extension [`@kliebhan/pi-prompt-autocomplete`](https://github.com/KLIEBHAN/pi-extensions/tree/main/extensions/prompt-autocomplete) with `--prompt-autocomplete-next-prompt`. After each settled turn it requests one predicted prompt and sends it with `set_editor_text`.

## The app

`scripts/fork/build-app.sh` builds the current commit with upstream's build script, then changes the bundle so both apps can run at once:

|                             | Official app                              | T3 Code (Fork)                                       |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| Bundle ID                   | `com.t3tools.t3code`                      | `com.kliebhan.t3code-fork`                           |
| T3 home (threads, settings) | `~/.t3`                                   | `~/.t3-fork`                                         |
| Browser profile             | `~/Library/Application Support/t3code-v2` | `~/.t3-fork/desktop-profile`                         |
| Keychain entry              | `t3code Safe Storage`                     | `t3code-fork Safe Storage`                           |
| Server port                 | 3773                                      | the next free port, 3774 while the official app runs |
| `t3code://` and web links   | handled                                   | not registered                                       |
| Updates                     | built-in updater                          | `scripts/fork/update.sh`                             |
| Signature                   | T3 Tools, Inc.                            | a local self-signed identity                         |

The fork app has the dev icon. Its menu bar still says "T3 Code (Nightly)": Electron finds its helper apps by that name. It is built without `.env`, so T3 Connect and the other cloud features are off.

The local signing identity lives in a keychain of its own under `~/workspace/t3code-fork-build/signing`, next to its password file. Every build is signed with it, so macOS keeps the app's privacy grants and keychain access across updates. An ad hoc signature would make macOS ask again after every update.

## Set up on a Mac

1. Check out `pi-prompt-suggestions` to `~/workspace/t3code-fork`, with remotes `origin` (this fork) and `upstream` (pingdotgg/t3code). Keep the checkout outside `~/Documents`, `~/Desktop`, and `~/Downloads`: launchd jobs there wait on macOS privacy prompts.
2. Install Vite+ to `~/workspace/t3code-fork-toolchain/vite-plus` (`VP_HOME=... bash` on the installer from the upstream README) and Rust with rustup. `scripts/fork/config.sh` holds these paths.
3. Run `scripts/fork/setup.sh`. It creates the signing identity, the fork's T3 home, and the launchd job `com.kliebhan.t3code-fork.update`.
4. Run `scripts/fork/update.sh` to build and install `/Applications/T3 Code (Fork).app`.
5. In the fork app, turn on Settings > Labs > Suggest next prompt and add `--prompt-autocomplete-next-prompt` to Settings > Providers > Pi > Launch arguments.

The flag needs `@kliebhan/pi-prompt-autocomplete` 0.4.0. Until that version is on npm, the launch arguments load a copy of the extension instead of the installed one, because Pi refuses to load both:

```text
--no-extensions -e builtin:mcp -e ~/.pi/agent/extensions/cpa.ts -e ~/workspace/t3code-fork-build/pi-prompt-autocomplete/index.ts --prompt-autocomplete-next-prompt
```

`--no-extensions` drops every other Pi extension, so list each one the fork app needs with its own `-e`.

## Updates

launchd starts `scripts/fork/update.sh --scheduled` at minute 30 of every hour. Once a day, from 04:00, the run syncs with upstream and builds; every run installs a waiting build if the fork app is closed, and leaves it waiting while the app runs. The installed app stays in place until the new one has been moved in. Run `scripts/fork/update.sh` by hand for a full run now. The log is `~/workspace/t3code-fork-build/logs/update.log`; failures and installed updates also show as a macOS notification.

`scripts/fork/sync-upstream.sh` does the merge:

1. It merges the newest `v*-nightly.*` tag in a scratch worktree, `~/workspace/t3code-fork-build/sync-worktree`.
2. It accepts the merge only if the result differs from the tag in fork-owned paths alone, the tests of both patches pass, and both packages typecheck.
3. On a conflict or a failed check, a model gets one attempt to repair the merge (`scripts/fork/merge-prompt.md`, run through `pi --print` with the model in `config.sh`). Its result has to pass step 2 like any other merge. The list of fork-owned paths is read before the merge, so the repair cannot widen it.
4. Only then does `pi-prompt-suggestions` move forward, and the script pushes it to `origin`. A push that fails is retried by the next run.

When a sync fails, the branch and the installed app stay as they were, and the attempt stays in the scratch worktree with `sync-report.txt` beside it until the next run. To finish it by hand, merge the tag on `pi-prompt-suggestions`, keep the behavior described under [Patches](#patches), run the commands from `sync-upstream.sh`, and push.

A patch that touches a new upstream file needs that path in `scripts/fork/owned-paths.txt`, in a commit of its own before the next sync.

## Remove it

```sh
launchctl bootout gui/$(id -u)/com.kliebhan.t3code-fork.update
rm ~/Library/LaunchAgents/com.kliebhan.t3code-fork.update.plist
rm -rf "/Applications/T3 Code (Fork).app" ~/workspace/t3code-fork-build
```

`~/.t3-fork` holds the fork app's threads and settings; delete it as well to remove them. The keychain entry `t3code-fork Safe Storage` can be deleted in Keychain Access.
