import type { PromptAutocompleteInput, PromptAutocompleteResult } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface PromptAutocompleteGenerationShape {
  readonly generatePromptAutocomplete: (
    input: PromptAutocompleteInput,
  ) => Effect.Effect<PromptAutocompleteResult>;
}

export class PromptAutocompleteGeneration extends Context.Service<
  PromptAutocompleteGeneration,
  PromptAutocompleteGenerationShape
>()("t3/promptAutocomplete/Services/PromptAutocompleteGeneration") {}
