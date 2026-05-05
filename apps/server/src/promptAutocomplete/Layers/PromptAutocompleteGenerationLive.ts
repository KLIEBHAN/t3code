import { type PromptAutocompleteInput, type PromptAutocompleteResult } from "@t3tools/contracts";
import { Cause, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { runTextGenerationStructuredOutput } from "../../textGenerationStructuredOutput.ts";
import { buildPromptAutocompleteContext } from "../promptAutocompleteContext.ts";
import {
  buildPromptAutocompletePrompt,
  sanitizePromptAutocompleteSuggestions,
} from "../promptAutocompleteGenerationLogic.ts";
import {
  PromptAutocompleteGeneration,
  type PromptAutocompleteGenerationShape,
} from "../Services/PromptAutocompleteGeneration.ts";

function emptyPromptAutocompleteResult(): PromptAutocompleteResult {
  return { suggestions: [] };
}

const makePromptAutocompleteGeneration = Effect.gen(function* () {
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
  }) =>
    runTextGenerationStructuredOutput(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
      Effect.provideService(ServerSettingsService, serverSettingsService),
    );

  const generatePromptAutocomplete: PromptAutocompleteGenerationShape["generatePromptAutocomplete"] =
    (input: PromptAutocompleteInput) =>
      Effect.gen(function* () {
        const snapshot = yield* projectionSnapshotQuery.getSnapshot();
        const context = buildPromptAutocompleteContext(snapshot, input);
        if (!context) {
          return emptyPromptAutocompleteResult();
        }

        const generated = yield* runStructuredOutput({
          operation: "generatePromptAutocomplete",
          cwd: context.cwd,
          prompt: buildPromptAutocompletePrompt(context),
          outputSchema: Schema.Struct({
            completions: Schema.Array(Schema.String),
          }),
        });

        return {
          suggestions: sanitizePromptAutocompleteSuggestions({
            draftBeforeCursor: context.draftBeforeCursor,
            suggestions: generated.completions,
          }),
        } satisfies PromptAutocompleteResult;
      }).pipe(
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          Effect.logDebug(
            `[prompt-autocomplete] falling back to no suggestions: ${Cause.pretty(cause)}`,
          ).pipe(Effect.as(emptyPromptAutocompleteResult())),
        ),
      ) as Effect.Effect<PromptAutocompleteResult, never, never>;

  return {
    generatePromptAutocomplete,
  } satisfies PromptAutocompleteGenerationShape;
});

export const PromptAutocompleteGenerationLive = Layer.effect(
  PromptAutocompleteGeneration,
  makePromptAutocompleteGeneration,
);
