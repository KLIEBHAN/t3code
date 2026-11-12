# Fork: Pi prompt suggestions

This fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) adds one feature: **Suggest next prompt** (Settings > Labs) works for Pi threads as well as Claude and Codex threads. Branch `pi-prompt-suggestions` follows the upstream nightly train; `main` is unused.

## The patch

Upstream's Pi adapter ignores the `set_editor_text` call that Pi extensions use to prefill the input. The patch in `packages/provider-pi/src/server/adapter.ts` turns that call into the `prompt_suggestion.updated` event Claude and Codex already emit. It applies the same rules as those adapters: the Labs setting is on, the turn before it completed, no turn is running, and the thread is not delegated. The test is `offers extension editor text after a completed turn as the next prompt` in `adapter.test.ts`.

The suggestion itself comes from the Pi extension [`@kliebhan/pi-prompt-autocomplete`](https://github.com/KLIEBHAN/pi-extensions/tree/main/extensions/prompt-autocomplete) with `--prompt-autocomplete-next-prompt`. After each settled turn it requests one predicted prompt and sends it with `set_editor_text`.

## Use it

1. Install a version of `@kliebhan/pi-prompt-autocomplete` that has `--prompt-autocomplete-next-prompt`.
2. Add `--prompt-autocomplete-next-prompt` to Settings > Providers > Pi > Launch arguments.
3. Turn on Settings > Labs > Suggest next prompt.

After a Pi turn completes, the empty composer shows the suggestion; `Tab` fills it in and `Escape` dismisses it. Each suggestion is one extra model request, made by the extension with its autocomplete model.

## Sync with upstream

`scripts/fork/sync-upstream.sh` merges the newest upstream `v*-nightly.*` tag into `pi-prompt-suggestions`, runs the Pi adapter tests and typecheck, and pushes the branch to `origin` (`--no-push` skips the push). It merges on a scratch branch `fork-sync` and moves `pi-prompt-suggestions` only after the checks pass.

The checkout lives in `~/workspace/t3code-fork` with remotes `origin` (KLIEBHAN/t3code) and `upstream` (pingdotgg/t3code). The script loads the Vite+ toolchain from `~/workspace/t3code-fork-toolchain/vite-plus/env`, or from `VP_ENV`; that toolchain is not on the login shell's `PATH`.

When the script reports a conflict, merge the tag by hand on `pi-prompt-suggestions`, keep the patch's behavior, run the checks from the script, and push. When checks fail, the merge waits on `fork-sync` for inspection.

## Try it without touching the installed app

```sh
. ~/workspace/t3code-fork-toolchain/vite-plus/env
vp run dev --home-dir ~/workspace/t3code-fork-e2e/home --no-seed
```

Open the pairing URL the dev runner prints. That instance keeps its own data and settings; give its Pi launch arguments an explicit `-e <path to prompt-autocomplete/index.ts>` to try an unreleased extension.
