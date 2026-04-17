import type { PromptImprovementInput, PromptImprovementResult } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface PromptImprovementGenerationShape {
  readonly generatePromptImprovement: (
    input: PromptImprovementInput,
  ) => Effect.Effect<PromptImprovementResult>;
}

export class PromptImprovementGeneration extends Context.Service<
  PromptImprovementGeneration,
  PromptImprovementGenerationShape
>()("t3/promptImprovement/Services/PromptImprovementGeneration") {}
