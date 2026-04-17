import type { ReplySuggestionsInput, ReplySuggestionsResult } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface ReplySuggestionGenerationShape {
  readonly generateReplySuggestions: (
    input: ReplySuggestionsInput,
  ) => Effect.Effect<ReplySuggestionsResult>;
}

export class ReplySuggestionGeneration extends Context.Service<
  ReplySuggestionGeneration,
  ReplySuggestionGenerationShape
>()("t3/suggestions/Services/ReplySuggestionGeneration") {}
