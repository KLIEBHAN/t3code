import { type ReplySuggestionsInput, type ReplySuggestionsResult } from "@t3tools/contracts";
import { Cause, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runTextGenerationStructuredOutput } from "../../textGenerationStructuredOutput.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { buildReplySuggestionContext } from "../replySuggestionContext.ts";
import {
  buildReplySuggestionPrompt,
  sanitizeReplySuggestions,
} from "../replySuggestionGenerationLogic.ts";
import {
  ReplySuggestionGeneration,
  type ReplySuggestionGenerationShape,
} from "../Services/ReplySuggestionGeneration.ts";

function emptyReplySuggestionsResult(): ReplySuggestionsResult {
  return { suggestions: [] };
}

const makeReplySuggestionGeneration = Effect.gen(function* () {
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

  const generateReplySuggestions: ReplySuggestionGenerationShape["generateReplySuggestions"] = (
    input: ReplySuggestionsInput,
  ) =>
    Effect.gen(function* () {
      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const context = buildReplySuggestionContext(snapshot, input);
      if (!context) {
        return emptyReplySuggestionsResult();
      }

      const generated = yield* runStructuredOutput({
        operation: "generateReplySuggestions",
        cwd: context.cwd,
        prompt: buildReplySuggestionPrompt({
          context,
          templateId: input.promptTemplateId,
          templateInstructions: input.promptTemplateInstructions,
        }),
        outputSchema: Schema.Struct({
          suggestions: Schema.Array(
            Schema.Struct({
              text: Schema.String,
            }),
          ),
        }),
      });

      return {
        suggestions: sanitizeReplySuggestions({
          suggestions: generated.suggestions,
          context,
        }),
      } satisfies ReplySuggestionsResult;
    }).pipe(
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        Effect.logDebug(
          `[reply-suggestions] falling back to no suggestions: ${Cause.pretty(cause)}`,
        ).pipe(Effect.as(emptyReplySuggestionsResult())),
      ),
    ) as Effect.Effect<ReplySuggestionsResult, never, never>;

  return {
    generateReplySuggestions,
  } satisfies ReplySuggestionGenerationShape;
});

export const ReplySuggestionGenerationLive = Layer.effect(
  ReplySuggestionGeneration,
  makeReplySuggestionGeneration,
);
