import {
  ClaudeSettings,
  CodexSettings,
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { runCodexStructuredOutput } from "./codexStructuredOutput.ts";
import { runClaudeStructuredOutput } from "./claudeStructuredOutput.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { resolveClaudeTextGenerationFallback } from "./textGenerationFallback.ts";
import {
  logTextGenerationFallback,
  logTextGenerationSelection,
} from "./textGenerationSelectionLog.ts";

const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");
const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER_KIND = ProviderDriverKind.make("cursor");
const OPENCODE_DRIVER_KIND = ProviderDriverKind.make("opencode");

const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const CURSOR_INSTANCE_ID = ProviderInstanceId.make("cursor");
const OPENCODE_INSTANCE_ID = ProviderInstanceId.make("opencode");

const DEFAULT_CODEX_TEXT_GENERATION_MODEL =
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[CODEX_DRIVER_KIND] ??
  DEFAULT_GIT_TEXT_GENERATION_MODEL;

function resolveTextGenerationDriver(settings: ServerSettings, modelSelection: ModelSelection) {
  const instanceConfig = settings.providerInstances[modelSelection.instanceId];
  if (instanceConfig !== undefined) {
    return instanceConfig.driver;
  }

  switch (modelSelection.instanceId) {
    case CLAUDE_INSTANCE_ID:
      return CLAUDE_DRIVER_KIND;
    case CURSOR_INSTANCE_ID:
      return CURSOR_DRIVER_KIND;
    case OPENCODE_INSTANCE_ID:
      return OPENCODE_DRIVER_KIND;
    default:
      return CODEX_DRIVER_KIND;
  }
}

function resolveCodexSettings(settings: ServerSettings, modelSelection: ModelSelection) {
  const instanceConfig = settings.providerInstances[modelSelection.instanceId];
  if (instanceConfig?.driver !== CODEX_DRIVER_KIND) {
    return Effect.succeed(settings.providers.codex);
  }

  return Schema.decodeEffect(CodexSettings)(instanceConfig.config ?? {}).pipe(
    Effect.orElseSucceed(() => settings.providers.codex),
  );
}

function resolveClaudeSettings(settings: ServerSettings, modelSelection: ModelSelection) {
  const instanceConfig = settings.providerInstances[modelSelection.instanceId];
  if (instanceConfig?.driver !== CLAUDE_DRIVER_KIND) {
    return Effect.succeed(settings.providers.claudeAgent);
  }

  return Schema.decodeEffect(ClaudeSettings)(instanceConfig.config ?? {}).pipe(
    Effect.orElseSucceed(() => settings.providers.claudeAgent),
  );
}

export function runTextGenerationStructuredOutput<S extends Schema.Top>(input: {
  operation: string;
  cwd: string;
  prompt: string;
  outputSchema: S;
  imagePaths?: ReadonlyArray<string>;
  cleanupPaths?: ReadonlyArray<string>;
}) {
  return Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const modelSelection = settings.textGenerationModelSelection;
    yield* logTextGenerationSelection({
      operation: input.operation,
      modelSelection,
    });
    const selectedDriver = resolveTextGenerationDriver(settings, modelSelection);

    if (selectedDriver === CLAUDE_DRIVER_KIND) {
      const claudeSettings = yield* resolveClaudeSettings(settings, modelSelection);
      return yield* runClaudeStructuredOutput({
        operation: input.operation,
        cwd: input.cwd,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        modelSelection,
        binaryPath: claudeSettings.binaryPath,
      }).pipe(
        Effect.catchTag("ClaudeStructuredOutputError", (error) =>
          Effect.gen(function* () {
            const fallbackSelection = resolveClaudeTextGenerationFallback({
              settings,
              errorDetail: error.detail,
            });
            if (!fallbackSelection) {
              return yield* error;
            }
            const codexSettings = yield* resolveCodexSettings(settings, fallbackSelection);

            yield* logTextGenerationFallback({
              operation: input.operation,
              from: modelSelection,
              to: fallbackSelection,
              reason: error.detail,
            });

            return yield* runCodexStructuredOutput({
              operation: input.operation,
              cwd: input.cwd,
              prompt: input.prompt,
              outputSchema: input.outputSchema,
              ...(input.imagePaths ? { imagePaths: input.imagePaths } : {}),
              ...(input.cleanupPaths ? { cleanupPaths: input.cleanupPaths } : {}),
              modelSelection: fallbackSelection,
              binaryPath: codexSettings.binaryPath,
              ...(codexSettings.homePath ? { homePath: codexSettings.homePath } : {}),
            });
          }),
        ),
      );
    }

    if (selectedDriver === OPENCODE_DRIVER_KIND || selectedDriver === CURSOR_DRIVER_KIND) {
      const fallbackSelection = {
        instanceId: CODEX_INSTANCE_ID,
        model: DEFAULT_CODEX_TEXT_GENERATION_MODEL,
      };
      const codexSettings = yield* resolveCodexSettings(settings, fallbackSelection);

      yield* logTextGenerationFallback({
        operation: input.operation,
        from: modelSelection,
        to: fallbackSelection,
        reason: `Structured output is not supported for ${selectedDriver}; using Codex instead.`,
      });

      return yield* runCodexStructuredOutput({
        operation: input.operation,
        cwd: input.cwd,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        ...(input.imagePaths ? { imagePaths: input.imagePaths } : {}),
        ...(input.cleanupPaths ? { cleanupPaths: input.cleanupPaths } : {}),
        modelSelection: fallbackSelection,
        binaryPath: codexSettings.binaryPath,
        ...(codexSettings.homePath ? { homePath: codexSettings.homePath } : {}),
      });
    }

    const codexSettings = yield* resolveCodexSettings(settings, modelSelection);
    return yield* runCodexStructuredOutput({
      operation: input.operation,
      cwd: input.cwd,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      ...(input.imagePaths ? { imagePaths: input.imagePaths } : {}),
      ...(input.cleanupPaths ? { cleanupPaths: input.cleanupPaths } : {}),
      modelSelection,
      binaryPath: codexSettings.binaryPath,
      ...(codexSettings.homePath ? { homePath: codexSettings.homePath } : {}),
    });
  });
}
