import type { ReplySuggestionsInput, ReplySuggestionsResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ReplySuggestionGenerationShape {
  readonly generateReplySuggestions: (
    input: ReplySuggestionsInput,
  ) => Effect.Effect<ReplySuggestionsResult>;
}

export class ReplySuggestionGeneration extends Context.Service<
  ReplySuggestionGeneration,
  ReplySuggestionGenerationShape
>()("t3/suggestions/Services/ReplySuggestionGeneration") {}
