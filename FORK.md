# Fork: Pi prompt suggestions

This fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) extends **Suggest next prompt** (Settings > Labs): it works for Pi threads as well as Claude and Codex threads, and a suggestion can be accepted in parts while typing. Branch `pi-prompt-suggestions` follows the upstream nightly tags. It builds a macOS app, **T3 Code (Fork)**, that takes the official app's place on a Mac and uses the same data.

## Patches

The fork differs from upstream only in the paths listed in `scripts/fork/owned-paths.txt`. Each change to upstream code is marked `Fork:` or covered by a test named below.

- **Pi suggestions** (`packages/provider-pi/src/server/adapter.ts`): upstream's Pi adapter ignores the `set_editor_text` call that Pi extensions use to prefill the input. After a completed turn the fork turns that call into the `prompt_suggestion.updated` event Claude and Codex emit, under the same rules: the Labs setting is on, no turn is running, and the thread is not delegated. Test: `offers extension editor text after a completed turn as the next prompt`.
- **Suggestion while typing** (`apps/web/src/components/composerGhostText.ts`, wired into `ComposerPromptEditorTiptap.tsx`, `chat/composerCommandKey.ts`, and `chat/ChatComposer.tsx`): upstream shows a suggestion only as the placeholder of an empty composer. In the fork its rest stays in grey after the caret while the draft is its start and the caret at the end. **Tab** fills in the rest, **Alt+Right** the next word, and **Escape** dismisses it, in an empty composer as before and now also mid-draft. While the draft does not start that suggestion, the same ghost text completes the draft itself: 350 ms after typing pauses, `chat/useDraftCompletion.ts` sends the draft and the thread's latest user and assistant message to `server.completeDraft` (see below) and shows the answer for the draft it was asked about. It runs only while **Suggest next prompt** is on and in the same composer states as the suggestion, and Escape hides it until the draft changes. **Ctrl+.** and **Ctrl+,** switch to the next or previous alternative, as in Pi: the first press asks `server.completeDraft` for three alternatives of the shown suggestion (`chat/useSuggestionAlternatives.ts`, `manual`, needs extension 0.6.0), later presses step through them, and in an empty composer it predicts whole prompts. As in Pi, Ctrl+. also works while a turn runs; the automatic completion while typing waits for the turn to end. **Ctrl+Shift+.** (the physical period key, so any layout) replaces a stale suggestion with fresh alternatives: it hides the one on screen, asks with `fresh` past the extension's cache (0.7.0), and shows the first alternative that differs from it. **Settings > Labs > Keys for suggestions** lists all these keys. They stay while the draft continues the text they were asked for. Tests: `composerGhostText.test.ts`, `composerGhostText.browser.test.tsx`.
- **Draft completion server** (`packages/provider-pi/src/server/draftCompletion.ts`, `apps/server/src/draftCompletion/DraftCompletion.ts`, the WebSocket method `server.completeDraft` in `contracts/src/rpc.ts`, `ws.ts`, `RpcAuthorization.ts`, and `RpcInstrumentation.ts`): completes the composer draft for the as-you-type ghost text. On first use of a model the server starts `pi --mode rpc --no-session --no-tools --prompt-autocomplete-model <model>` and keeps it and asks it with `/prompt-autocomplete complete <json>` (needs `@kliebhan/pi-prompt-autocomplete` 0.5.0); a Pi that exits is started again by the next request. It answers only while **Suggest next prompt** is on and uses the first enabled Pi provider's binary and environment. The model and its Pi provider instance come with each request: **Settings > Labs > Model for suggestions while typing** (`draftCompletionModel`, `draftCompletionInstanceId`), or with **Like the chat** the thread's Pi model, else `cpa/cpa-small` on the first enabled Pi instance (`T3CODE_DRAFT_COMPLETION_MODEL` overrides that default). Each instance and model in use gets its own Pi process, at most three; the least recently used one is stopped beyond that. Tests: `draftCompletion.test.ts` (against a stand-in Pi).
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
3. Run `scripts/fork/setup.sh`. It checks that the signing certificate is in the keychain, copies the senders of the Pi skills `bark` and `ntfy` with their `.env` to `~/workspace/t3code-fork-build/push/` and links a Python 3.10 or newer there (macOS's own is 3.9), and creates the launchd job `com.kliebhan.t3code-fork.update`. The job uses only those copies, because the skills live in `~/Documents` and every access there from a background job goes through the macOS privacy check. Run `setup.sh` again when the Bark or ntfy credentials change, and once on a Mac set up before these pushes existed; until then a failing run logs that it has no Python for pushes. If `codesign` asks for the key on the first build, choose **Always Allow**.
4. Run `scripts/fork/update.sh` to build and install `/Applications/T3 Code (Fork).app`.
5. Follow [Switch from the official app](#switch-from-the-official-app).

## Switch from the official app

1. Check that the fork app is at least as new as the official app (**Settings > About** in each, or `CFBundleShortVersionString` in each bundle's `Info.plist`). An older server must not open a database a newer one has migrated; `scripts/fork/update.sh` brings the fork app up to the newest nightly.
2. Quit the official app. Running threads stop; with **Continue threads after restarts** on, supported ones resume in the fork app.
3. Open **T3 Code (Fork)**. The first time, macOS asks whether it may use `t3code Safe Storage`: enter the login password and choose **Always Allow**. That entry holds the key for the saved secrets and connections.
4. Turn on **Settings > Labs > Suggest next prompt** and add `--prompt-autocomplete-next-prompt` to **Settings > Providers > Pi > Launch arguments**.

The flag needs `@kliebhan/pi-prompt-autocomplete` 0.4.0 or later, draft completion 0.5.0, alternatives 0.6.0. Install a new minor version with `npm_config_prefer_online=true pi install npm:@kliebhan/pi-prompt-autocomplete`: `pi update` stays within the recorded `^0.x` range, and the setting skips npm's stale cache. Each suggestion is one extra model request; `--prompt-autocomplete-model <provider/model>` in the same launch arguments picks a fast model for it.

A suggestion belongs to a thread's latest completed turn and lives in the server's memory. A thread from before the switch shows one after its next turn, and quitting the app drops the suggestions it holds.

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

launchd starts `scripts/fork/update.sh --scheduled` at minute 30 of every hour. Once a day, from 04:00, the run syncs with upstream and builds. In between, every run takes fork commits merged on `origin` (fast-forward only) and builds them, so a merged change reaches both Macs within the hour; a build that fails is retried only once the branch moves or at the daily run. Every run installs a waiting build if the fork app is closed. A running app is restarted for it only between 02:00 and 06:00 and only while the database shows no unfinished run; otherwise the build waits. The app is quit with the signal upstream treats as a clean quit and started again afterwards, and threads that were interrupted resume if **Continue threads after restarts** is on. The installed app stays in place until the new one has been moved in. Run `scripts/fork/update.sh` by hand for a full run now. The log is `~/workspace/t3code-fork-build/logs/update.log`, each line with its time; failures and installed updates also show as a macOS notification. Failures of a scheduled run also go to the phone through Bark and ntfy, prefixed with the Mac's name. A new build of a scheduled run is announced the same way once, from the build Mac and with Bark's info sound, for all Macs.

**Update by hand:** open **T3 Code Fork Update** (`~/Applications`, created by `setup.sh` through `scripts/fork/install-applet.sh`; drag it into the Dock). Each `update.sh` run compiles it again when its source or its icon changed, unless it is open at that moment. Its icon in `scripts/fork/applet-icon/` is upstream's Icon Composer icon with an update badge, built by `scripts/fork/make-applet-icon.sh` (needs Xcode); run that again only to change the look. It starts `scripts/fork/manual-update.sh` in the background, a full `update.sh` run whose output goes into `update.log` as it runs, and shows a progress window with the current step of four (check, merge, build or fetch, install). Closing the window or the applet does not stop the update, and an update that takes over an hour is reported as still running. Its dialogs come to the front by themselves and close after 10 minutes without an answer; an unanswered restart question counts as **Später**. In that question **Später** is preselected, so Return while typing elsewhere does not restart the app, and **Was ist neu?** opens upstream's release notes for the new nightly. When a build is ready but the app runs, it says how many threads are running and asks before it restarts the app (`update.sh --restart`); without the restart, the nightly run installs the build once no thread runs.

`scripts/fork/sync-upstream.sh` does the merge:

1. It merges the newest `v*-nightly.*` tag in a scratch worktree, `~/workspace/t3code-fork-build/sync-worktree`.
2. It accepts the merge only if the result differs from the tag in fork-owned paths alone, the tests of both patches pass, and both packages typecheck.
3. On a conflict or a failed check, a model gets one attempt to repair the merge (`scripts/fork/merge-prompt.md`, run through `pi --print` with `cpa/cpa-worker-plus`, or `FORK_MERGE_MODEL` if set). Its result has to pass step 2 like any other merge. The list of fork-owned paths is read before the merge, so the repair cannot widen it.
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

`setup.sh --build-host` stores the host in the checkout's git config (`fork.buildHost`) and installs the same launchd job. On such a Mac every hourly run asks the build Mac for its newest app, its waiting build if it has one. A new one is copied with `rsync`, checked with `codesign --verify`, and installed while the fork app is closed. A build Mac that is not reachable is skipped without a message. Before it fetches, a run moves the scripts to the head of `pi-prompt-suggestions` when that contains the app the build Mac offers, otherwise to that app's commit. So scripts merged after the last build stay, and an app never runs with scripts older than itself.

Then follow [Switch from the official app](#switch-from-the-official-app).

## Remove it

```sh
launchctl bootout gui/$(id -u)/com.kliebhan.t3code-fork.update
rm ~/Library/LaunchAgents/com.kliebhan.t3code-fork.update.plist
rm -rf "/Applications/T3 Code (Fork).app" ~/workspace/t3code-fork-build
```

The data in `~/.t3` belongs to the official app as much as to the fork app and stays.
