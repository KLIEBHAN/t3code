# Fork: Pi prompt suggestions

This fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) adds one feature: **Suggest next prompt** (Settings > Labs) works for Pi threads as well as Claude and Codex threads. Branch `pi-prompt-suggestions` follows the upstream nightly tags. It builds a macOS app, **T3 Code (Fork)**, that takes the official app's place on a Mac and uses the same data.

## Patches

The fork differs from upstream only in the paths listed in `scripts/fork/owned-paths.txt`. Each change to upstream code is marked `Fork:` or covered by a test named below.

- **Pi suggestions** (`packages/provider-pi/src/server/adapter.ts`): upstream's Pi adapter ignores the `set_editor_text` call that Pi extensions use to prefill the input. After a completed turn the fork turns that call into the `prompt_suggestion.updated` event Claude and Codex emit, under the same rules: the Labs setting is on, no turn is running, and the thread is not delegated. Test: `offers extension editor text after a completed turn as the next prompt`.
- **Own browser profile for another T3 home** (`apps/desktop/src/app/DesktopUserData.ts`): on macOS, an app started with `T3CODE_HOME` set to something other than `~/.t3` keeps its Chromium profile in `<T3 home>/desktop-profile`. Upstream uses one fixed profile, which also holds the single-instance lock. With the patch, a build can be tried on a copy of the data while the daily app runs; see [Try a build on a copy of the data](#try-a-build-on-a-copy-of-the-data). Test: `keeps a separate profile on macOS for a T3 home other than ~/.t3`.

The suggestion text comes from the Pi extension [`@kliebhan/pi-prompt-autocomplete`](https://github.com/KLIEBHAN/pi-extensions/tree/main/extensions/prompt-autocomplete) with `--prompt-autocomplete-next-prompt`. After each settled turn it requests one predicted prompt and sends it with `set_editor_text`.

## The app

`scripts/fork/build-app.sh` builds the current commit with upstream's build script and then gives the bundle an identity of its own. Everything that decides which data the app uses is upstream's code, so the fork app works on the official app's data:

|                             | Official app                              | T3 Code (Fork)                   |
| --------------------------- | ----------------------------------------- | -------------------------------- |
| T3 home (threads, settings) | `~/.t3`                                   | the same                         |
| Browser profile             | `~/Library/Application Support/t3code-v2` | the same                         |
| Keychain entry              | `t3code Safe Storage`                     | the same                         |
| Server port                 | 3773                                      | the same                         |
| Bundle ID                   | `com.t3tools.t3code`                      | `com.kliebhan.t3code-fork`       |
| `t3code://` and web links   | handled                                   | not registered                   |
| Updates                     | built-in updater                          | `scripts/fork/update.sh`         |
| Signature                   | T3 Tools, Inc.                            | an Apple Development certificate |

Only one of the two apps can run at a time: they share the T3 home and the profile lock. Threads, scheduled tasks, paired devices, and access tokens all live in the T3 home, so they carry over in both directions.

The fork app has the dev icon. Its menu bar still says "T3 Code (Nightly)": Electron finds its helper apps by that name. It is built without `.env`, so T3 Connect and the other cloud features are off.

Every build is signed with the Apple Development certificate named in `scripts/fork/config.sh`, from the login keychain. macOS ties keychain access and privacy grants to the certificate's team, so they survive every rebuild. A self-signed or ad hoc signature has no team: macOS then binds keychain access to the exact build and shows a keychain dialog after every update. The certificate expires after a year; Xcode renews it, and a build with an expired certificate fails with a message.

## Set up on a Mac

1. Check out `pi-prompt-suggestions` to `~/workspace/t3code-fork`, with remotes `origin` (this fork) and `upstream` (pingdotgg/t3code). Keep the checkout outside `~/Documents`, `~/Desktop`, and `~/Downloads`: launchd jobs there wait on macOS privacy prompts.
2. Install Vite+ to `~/workspace/t3code-fork-toolchain/vite-plus` (`VP_HOME=... bash` on the installer from the upstream README) and Rust with rustup. `scripts/fork/config.sh` holds these paths.
3. Run `scripts/fork/setup.sh`. It checks that the signing certificate is in the keychain and creates the launchd job `com.kliebhan.t3code-fork.update`. If `codesign` asks for the key on the first build, choose **Always Allow**.
4. Run `scripts/fork/update.sh` to build and install `/Applications/T3 Code (Fork).app`.
5. Follow [Switch from the official app](#switch-from-the-official-app).

## Switch from the official app

1. Check that the fork app is at least as new as the official app (**Settings > About** in each, or `CFBundleShortVersionString` in each bundle's `Info.plist`). An older server must not open a database a newer one has migrated; `scripts/fork/update.sh` brings the fork app up to the newest nightly.
2. Quit the official app. Running threads stop; with **Continue threads after restarts** on, supported ones resume in the fork app.
3. Open **T3 Code (Fork)**. The first time, macOS asks whether it may use `t3code Safe Storage`: enter the login password and choose **Always Allow**. That entry holds the key for the saved secrets and connections.
4. Turn on **Settings > Labs > Suggest next prompt** and add `--prompt-autocomplete-next-prompt` to **Settings > Providers > Pi > Launch arguments**.

The flag needs `@kliebhan/pi-prompt-autocomplete` 0.4.0 or later (`pi update npm:@kliebhan/pi-prompt-autocomplete`). Each suggestion is one extra model request; `--prompt-autocomplete-model <provider/model>` in the same launch arguments picks a fast model for it.

From then on, open only the fork app on that Mac. The official app updates itself and can migrate the database to a version the fork has not merged yet. To go back, quit the fork app and open the official one; that is safe while the official app is at least as new as the fork app.

## Try a build on a copy of the data

A copy of a live T3 home repeats real work when a server starts on it: scheduled tasks, pending actions, and interrupted threads. Upstream's `migrate-dev-db` makes a copy without them, with a few recent projects and their stopped threads:

```sh
node apps/server/scripts/migrate-dev-db.ts --base-dir /path/to/copy/.t3
env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" SHELL=/bin/zsh PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR="$TMPDIR" \
  T3CODE_HOME=/path/to/copy/.t3 "<app>/Contents/MacOS/T3 Code (Nightly)"
```

Started this way the app runs beside the daily one, on the next free port. `<T3 home>/bin/t3 pair --base-dir /path/to/copy/.t3` prints a link for a browser. Use a throwaway project for new threads: a thread in a real project works in the real checkout.

## Updates

launchd starts `scripts/fork/update.sh --scheduled` at minute 30 of every hour. Once a day, from 04:00, the run syncs with upstream and builds; every run installs a waiting build if the fork app is closed, and leaves it waiting while the app runs. The installed app stays in place until the new one has been moved in. Run `scripts/fork/update.sh` by hand for a full run now. The log is `~/workspace/t3code-fork-build/logs/update.log`; failures and installed updates also show as a macOS notification.

`scripts/fork/sync-upstream.sh` does the merge:

1. It merges the newest `v*-nightly.*` tag in a scratch worktree, `~/workspace/t3code-fork-build/sync-worktree`.
2. It accepts the merge only if the result differs from the tag in fork-owned paths alone, the tests of both patches pass, and both packages typecheck.
3. On a conflict or a failed check, a model gets one attempt to repair the merge (`scripts/fork/merge-prompt.md`, run through `pi --print` with the model in `config.sh`). Its result has to pass step 2 like any other merge. The list of fork-owned paths is read before the merge, so the repair cannot widen it.
4. Only then does `pi-prompt-suggestions` move forward, and the script pushes it to `origin`. A push that fails is retried by the next run.

When a sync fails, the branch and the installed app stay as they were, and the attempt stays in the scratch worktree with `sync-report.txt` beside it until the next run. To finish it by hand, merge the tag on `pi-prompt-suggestions`, keep the behavior described under [Patches](#patches), run the commands from `sync-upstream.sh`, and push.

A patch that touches a new upstream file needs that path in `scripts/fork/owned-paths.txt`, in a commit of its own before the next sync.

## A second Mac

A second Mac can install the app the first one builds. It needs no signing certificate, toolchain, or full checkout, only SSH access to the build Mac without a password prompt. Both Macs need the same home folder path, such as `/Users/fabi`: the second Mac reads the app from the paths `scripts/fork/config.sh` gives.

```sh
cd ~/workspace
git clone --depth 1 --filter=blob:none --sparse --branch pi-prompt-suggestions https://github.com/KLIEBHAN/t3code.git t3code-fork
cd t3code-fork && git sparse-checkout set scripts/fork
scripts/fork/setup.sh --build-host <ssh host of the build Mac>
scripts/fork/update.sh
```

`setup.sh --build-host` stores the host in the checkout's git config (`fork.buildHost`) and installs the same launchd job. On such a Mac every hourly run asks the build Mac for its newest app, its waiting build if it has one. A new one is copied with `rsync`, checked with `codesign --verify`, and installed while the fork app is closed. A build Mac that is not reachable is skipped without a message. The scripts move to the commit of the newest app at the start of the following run.

Then follow [Switch from the official app](#switch-from-the-official-app).

## Remove it

```sh
launchctl bootout gui/$(id -u)/com.kliebhan.t3code-fork.update
rm ~/Library/LaunchAgents/com.kliebhan.t3code-fork.update.plist
rm -rf "/Applications/T3 Code (Fork).app" ~/workspace/t3code-fork-build
```

The data in `~/.t3` belongs to the official app as much as to the fork app and stays.
