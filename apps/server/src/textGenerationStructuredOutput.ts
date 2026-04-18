import { DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER } from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { runCodexStructuredOutput } from "./codexStructuredOutput.ts";
import { runClaudeStructuredOutput } from "./claudeStructuredOutput.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { resolveClaudeTextGenerationFallback } from "./textGenerationFallback.ts";
import {
  logTextGenerationFallback,
  logTextGenerationSelection,
} from "./textGenerationSelectionLog.ts";

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

    if (modelSelection.provider === "claudeAgent") {
      return yield* runClaudeStructuredOutput({
        operation: input.operation,
        cwd: input.cwd,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        modelSelection,
        binaryPath: settings.providers.claudeAgent.binaryPath,
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
              binaryPath: settings.providers.codex.binaryPath,
              ...(settings.providers.codex.homePath
                ? { homePath: settings.providers.codex.homePath }
                : {}),
            });
          }),
        ),
      );
    }

    if (modelSelection.provider === "opencode" || modelSelection.provider === "cursor") {
      const fallbackSelection = {
        provider: "codex" as const,
        model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
      };

      yield* logTextGenerationFallback({
        operation: input.operation,
        from: modelSelection,
        to: fallbackSelection,
        reason: `Structured output is not supported for ${modelSelection.provider}; using Codex instead.`,
      });

      return yield* runCodexStructuredOutput({
        operation: input.operation,
        cwd: input.cwd,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        ...(input.imagePaths ? { imagePaths: input.imagePaths } : {}),
        ...(input.cleanupPaths ? { cleanupPaths: input.cleanupPaths } : {}),
        modelSelection: fallbackSelection,
        binaryPath: settings.providers.codex.binaryPath,
        ...(settings.providers.codex.homePath
          ? { homePath: settings.providers.codex.homePath }
          : {}),
      });
    }

    return yield* runCodexStructuredOutput({
      operation: input.operation,
      cwd: input.cwd,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      ...(input.imagePaths ? { imagePaths: input.imagePaths } : {}),
      ...(input.cleanupPaths ? { cleanupPaths: input.cleanupPaths } : {}),
      modelSelection,
      binaryPath: settings.providers.codex.binaryPath,
      ...(settings.providers.codex.homePath ? { homePath: settings.providers.codex.homePath } : {}),
    });
  });
}
