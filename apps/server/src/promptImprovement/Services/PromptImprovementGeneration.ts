import type { PromptImprovementInput, PromptImprovementResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface PromptImprovementGenerationShape {
  readonly generatePromptImprovement: (
    input: PromptImprovementInput,
  ) => Effect.Effect<PromptImprovementResult>;
}

export class PromptImprovementGeneration extends Context.Service<
  PromptImprovementGeneration,
  PromptImprovementGenerationShape
>()("t3/promptImprovement/Services/PromptImprovementGeneration") {}
