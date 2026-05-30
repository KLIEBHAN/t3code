import type { PromptAutocompleteInput, PromptAutocompleteResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface PromptAutocompleteGenerationShape {
  readonly generatePromptAutocomplete: (
    input: PromptAutocompleteInput,
  ) => Effect.Effect<PromptAutocompleteResult>;
}

export class PromptAutocompleteGeneration extends Context.Service<
  PromptAutocompleteGeneration,
  PromptAutocompleteGenerationShape
>()("t3/promptAutocomplete/Services/PromptAutocompleteGeneration") {}
