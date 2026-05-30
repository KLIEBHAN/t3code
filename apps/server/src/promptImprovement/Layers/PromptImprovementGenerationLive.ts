import type { PromptImprovementInput, PromptImprovementResult } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { makeComposerAssistTextGeneration } from "../../composerAssistTextGeneration.ts";
import { makeComposerAssistThreadSourceLoader } from "../../composerAssistThreadSource.ts";
import { buildPromptImprovementContext } from "../promptImprovementContext.ts";
import {
  buildNoopPromptImprovementResult,
  buildPromptImprovementPrompt,
  sanitizePromptImprovement,
} from "../promptImprovementLogic.ts";
import {
  PromptImprovementGeneration,
  type PromptImprovementGenerationShape,
} from "../Services/PromptImprovementGeneration.ts";

const PromptImprovementOutput = Schema.Struct({ improvedPrompt: Schema.String });

const makePromptImprovementGeneration = Effect.gen(function* () {
  const loadThreadSource = yield* makeComposerAssistThreadSourceLoader;
  const generateStructured = yield* makeComposerAssistTextGeneration;

  const generatePromptImprovement: PromptImprovementGenerationShape["generatePromptImprovement"] = (
    input: PromptImprovementInput,
  ) =>
    Effect.gen(function* () {
      const context = buildPromptImprovementContext(yield* loadThreadSource(input.threadId));
      if (!context) {
        return buildNoopPromptImprovementResult({
          originalPrompt: input.prompt,
          reason: "Prompt improvement is unavailable for this thread.",
        });
      }

      const generated = yield* generateStructured({
        cwd: context.cwd,
        prompt: buildPromptImprovementPrompt({ context, prompt: input.prompt }),
        outputSchema: PromptImprovementOutput,
      });

      return sanitizePromptImprovement({
        originalPrompt: input.prompt,
        improvedPrompt: generated.improvedPrompt,
        unchangedReason: "Prompt already looks good.",
      }) satisfies PromptImprovementResult;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logDebug(
          `[prompt-improvement] falling back to original prompt: ${Cause.pretty(cause)}`,
        ).pipe(
          Effect.as(
            buildNoopPromptImprovementResult({
              originalPrompt: input.prompt,
              reason: "Prompt improvement failed, so the original draft was kept.",
            }),
          ),
        ),
      ),
    );

  return { generatePromptImprovement } satisfies PromptImprovementGenerationShape;
});

export const PromptImprovementGenerationLive = Layer.effect(
  PromptImprovementGeneration,
  makePromptImprovementGeneration,
);
