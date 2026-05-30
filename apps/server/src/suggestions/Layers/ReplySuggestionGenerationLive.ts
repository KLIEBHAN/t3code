import type { ReplySuggestionsInput, ReplySuggestionsResult } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { makeComposerAssistTextGeneration } from "../../composerAssistTextGeneration.ts";
import { makeComposerAssistThreadSourceLoader } from "../../composerAssistThreadSource.ts";
import { buildReplySuggestionContext } from "../replySuggestionContext.ts";
import {
  buildReplySuggestionPrompt,
  sanitizeReplySuggestions,
} from "../replySuggestionGenerationLogic.ts";
import {
  ReplySuggestionGeneration,
  type ReplySuggestionGenerationShape,
} from "../Services/ReplySuggestionGeneration.ts";

const ReplySuggestionsOutput = Schema.Struct({
  suggestions: Schema.Array(Schema.Struct({ text: Schema.String })),
});

function emptyReplySuggestionsResult(): ReplySuggestionsResult {
  return { suggestions: [] };
}

const makeReplySuggestionGeneration = Effect.gen(function* () {
  const loadThreadSource = yield* makeComposerAssistThreadSourceLoader;
  const generateStructured = yield* makeComposerAssistTextGeneration;

  const generateReplySuggestions: ReplySuggestionGenerationShape["generateReplySuggestions"] = (
    input: ReplySuggestionsInput,
  ) =>
    Effect.gen(function* () {
      const context = buildReplySuggestionContext(yield* loadThreadSource(input.threadId), input);
      if (!context) {
        return emptyReplySuggestionsResult();
      }

      const generated = yield* generateStructured({
        cwd: context.cwd,
        prompt: buildReplySuggestionPrompt({
          context,
          templateId: input.promptTemplateId,
          templateInstructions: input.promptTemplateInstructions,
        }),
        outputSchema: ReplySuggestionsOutput,
      });

      return {
        suggestions: sanitizeReplySuggestions({
          suggestions: generated.suggestions,
          context,
        }),
      } satisfies ReplySuggestionsResult;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logDebug(
          `[reply-suggestions] falling back to no suggestions: ${Cause.pretty(cause)}`,
        ).pipe(Effect.as(emptyReplySuggestionsResult())),
      ),
    );

  return { generateReplySuggestions } satisfies ReplySuggestionGenerationShape;
});

export const ReplySuggestionGenerationLive = Layer.effect(
  ReplySuggestionGeneration,
  makeReplySuggestionGeneration,
);
