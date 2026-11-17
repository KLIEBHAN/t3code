// Fork: completes the composer draft as the user types, through one Pi process
// that runs @kliebhan/pi-prompt-autocomplete 0.5.0 or later.
import {
  providerInstanceConfigEnabledFlag,
  type DraftCompletionInput,
  type DraftCompletionResult,
} from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { makePiDraftCompleter } from "@t3tools/provider-pi/server/draftCompletion";
import { PiSettings } from "@t3tools/provider-pi/settings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";

/** Model the extension completes drafts with; T3CODE_DRAFT_COMPLETION_MODEL overrides it. */
const DRAFT_COMPLETION_MODEL = process.env.T3CODE_DRAFT_COMPLETION_MODEL?.trim() || "cpa/cpa-small";

const decodePiSettings = Schema.decodeUnknownOption(PiSettings);
const nothing: DraftCompletionResult = { completion: null, completions: [] };

export class DraftCompletion extends Context.Service<
  DraftCompletion,
  {
    /** Texts to append to the draft; none while Suggest next prompt is off or Pi has nothing. */
    readonly complete: (input: DraftCompletionInput) => Effect.Effect<DraftCompletionResult>;
  }
>()("t3/draftCompletion/DraftCompletion") {}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const random = yield* SecureRandom.SecureRandom;
  const scope = yield* Effect.scope;
  const buildLock = yield* Semaphore.make(1);
  let completer:
    | {
        readonly instanceId: string;
        readonly sidecar: Effect.Success<ReturnType<typeof makePiDraftCompleter>>;
      }
    | undefined;

  // The first Pi instance the provider registry would treat as enabled, rechecked on every
  // request so disabling the provider stops completions at once.
  const currentPiInstance = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    for (const [instanceId, entry] of Object.entries(settings.providerInstances)) {
      if (String(entry.driver) !== "pi") continue;
      const config = Option.getOrUndefined(decodePiSettings(entry.config ?? {}));
      const rawEnabled = providerInstanceConfigEnabledFlag(entry.config);
      const enabled =
        entry.enabled !== false &&
        rawEnabled !== false &&
        (entry.enabled ?? providerInstanceConfigEnabledFlag(config) ?? true);
      if (enabled) return { instanceId, entry, config };
    }
    return undefined;
  });

  // Built on first use and kept for the server's lifetime. An environment with secret
  // references is not launched: resolving them belongs to the provider registry, and Pi
  // would otherwise run on inherited credentials.
  const getCompleter = buildLock.withPermits(1)(
    Effect.gen(function* () {
      const instance = yield* currentPiInstance;
      if (instance === undefined) return null;
      if (completer !== undefined && completer.instanceId === instance.instanceId) {
        return completer.sidecar;
      }
      const variables = instance.entry.environment ?? [];
      if (variables.some((variable) => typeof variable.value !== "string")) return null;
      const environment = yield* mergeProviderInstanceEnvironment(variables);
      const sidecar = yield* makePiDraftCompleter({
        command: instance.config?.binaryPath || "pi",
        environment,
        cwd: config.stateDir,
        model: DRAFT_COMPLETION_MODEL,
      }).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(SecureRandom.SecureRandom, random),
      );
      completer = { instanceId: instance.instanceId, sidecar };
      return sidecar;
    }),
  );

  const complete = Effect.fn("DraftCompletion.complete")(
    function* (input: DraftCompletionInput) {
      const settings = yield* settingsService.getSettings;
      if (!settings.promptSuggestionsEnabled) return nothing;
      // Only a request the user made completes an empty draft into a whole prompt.
      if (input.manual !== true && input.draft.trim().length === 0) return nothing;
      const sidecar = yield* getCompleter;
      if (sidecar === null) return nothing;
      const completions = yield* sidecar.complete(input);
      const result: DraftCompletionResult = { completion: completions[0] ?? null, completions };
      return result;
    },
    (effect): Effect.Effect<DraftCompletionResult> =>
      effect.pipe(Effect.orElseSucceed(() => nothing)),
  );

  return DraftCompletion.of({ complete });
});

export const layer = Layer.effect(DraftCompletion, make);
