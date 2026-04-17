import { type PromptImprovementInput, type PromptImprovementResult } from "@t3tools/contracts";
import { Cause, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runTextGenerationStructuredOutput } from "../../textGenerationStructuredOutput.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { buildPromptImprovementContext } from "../promptImprovementContext.ts";
import {
  buildNoopPromptImprovementResult,
  buildPromptImprovementPrompt,
  sanitizePromptImprovement,
} from "../promptImprovementLogic.ts";
import {
  PromptImprovementGeneration,
  type PromptImprovementGenerationShape,
} from "../Services/PromptImprovementGeneration.ts";

const makePromptImprovementGeneration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettingsService = yield* ServerSettingsService;

  const runStructuredOutput = <S extends Schema.Top>(input: {
    operation: string;
    cwd: string;
    prompt: string;
    outputSchema: S;
    imagePaths?: ReadonlyArray<string>;
    cleanupPaths?: ReadonlyArray<string>;
  }) =>
    runTextGenerationStructuredOutput(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
      Effect.provideService(ServerSettingsService, serverSettingsService),
    );

  const generatePromptImprovement: PromptImprovementGenerationShape["generatePromptImprovement"] = (
    input: PromptImprovementInput,
  ) =>
    Effect.gen(function* () {
      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const context = buildPromptImprovementContext(snapshot, input);
      if (!context) {
        return buildNoopPromptImprovementResult({
          originalPrompt: input.prompt,
          reason: "Prompt improvement is unavailable for this thread.",
        });
      }

      const generated = yield* runStructuredOutput({
        operation: "generatePromptImprovement",
        cwd: context.cwd,
        prompt: buildPromptImprovementPrompt({
          context,
          prompt: input.prompt,
        }),
        outputSchema: Schema.Struct({
          improvedPrompt: Schema.String,
        }),
      });

      return sanitizePromptImprovement({
        originalPrompt: input.prompt,
        improvedPrompt: generated.improvedPrompt,
        unchangedReason: "Prompt already looks good.",
      }) satisfies PromptImprovementResult;
    }).pipe(
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        Effect.logDebug(
          `[prompt-improvement] falling back to original prompt: ${Cause.pretty(cause)}`,
        ).pipe(
          Effect.as(
            buildNoopPromptImprovementResult({
              originalPrompt: input.prompt,
              reason: "Prompt improvement failed, so the original draft was kept.",
            }),
          ),
        ),
      ),
    ) as Effect.Effect<PromptImprovementResult, never, never>;

  return {
    generatePromptImprovement,
  } satisfies PromptImprovementGenerationShape;
});

export const PromptImprovementGenerationLive = Layer.effect(
  PromptImprovementGeneration,
  makePromptImprovementGeneration,
);
