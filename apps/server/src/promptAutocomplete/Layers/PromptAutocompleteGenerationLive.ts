import type { PromptAutocompleteInput, PromptAutocompleteResult } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { makeComposerAssistTextGeneration } from "../../composerAssistTextGeneration.ts";
import { makeComposerAssistThreadSourceLoader } from "../../composerAssistThreadSource.ts";
import { buildPromptAutocompleteContext } from "../promptAutocompleteContext.ts";
import {
  buildPromptAutocompletePrompt,
  sanitizePromptAutocompleteSuggestions,
} from "../promptAutocompleteGenerationLogic.ts";
import {
  PromptAutocompleteGeneration,
  type PromptAutocompleteGenerationShape,
} from "../Services/PromptAutocompleteGeneration.ts";

const PromptAutocompleteOutput = Schema.Struct({ completions: Schema.Array(Schema.String) });

function emptyPromptAutocompleteResult(): PromptAutocompleteResult {
  return { suggestions: [] };
}

const makePromptAutocompleteGeneration = Effect.gen(function* () {
  const loadThreadSource = yield* makeComposerAssistThreadSourceLoader;
  const generateStructured = yield* makeComposerAssistTextGeneration;

  const generatePromptAutocomplete: PromptAutocompleteGenerationShape["generatePromptAutocomplete"] =
    (input: PromptAutocompleteInput) =>
      Effect.gen(function* () {
        const context = buildPromptAutocompleteContext(
          yield* loadThreadSource(input.threadId),
          input,
        );
        if (!context) {
          return emptyPromptAutocompleteResult();
        }

        const generated = yield* generateStructured({
          cwd: context.cwd,
          prompt: buildPromptAutocompletePrompt(context),
          outputSchema: PromptAutocompleteOutput,
        });

        return {
          suggestions: sanitizePromptAutocompleteSuggestions({
            draftBeforeCursor: context.draftBeforeCursor,
            suggestions: generated.completions,
          }),
        } satisfies PromptAutocompleteResult;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug(
            `[prompt-autocomplete] falling back to no suggestions: ${Cause.pretty(cause)}`,
          ).pipe(Effect.as(emptyPromptAutocompleteResult())),
        ),
      );

  return { generatePromptAutocomplete } satisfies PromptAutocompleteGenerationShape;
});

export const PromptAutocompleteGenerationLive = Layer.effect(
  PromptAutocompleteGeneration,
  makePromptAutocompleteGeneration,
);
