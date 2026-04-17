import { Schema } from "effect";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const MAX_PROMPT_IMPROVEMENT_LENGTH = 12_000;
export const MAX_PROMPT_IMPROVEMENT_REASON_LENGTH = 240;

export const PromptImprovementText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MAX_PROMPT_IMPROVEMENT_LENGTH),
);
export type PromptImprovementText = typeof PromptImprovementText.Type;

export const PromptImprovementInput = Schema.Struct({
  threadId: ThreadId,
  prompt: PromptImprovementText,
});
export type PromptImprovementInput = typeof PromptImprovementInput.Type;

export const PromptImprovementResult = Schema.Struct({
  improvedPrompt: PromptImprovementText,
  changed: Schema.Boolean,
  reason: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_PROMPT_IMPROVEMENT_REASON_LENGTH)),
  ),
});
export type PromptImprovementResult = typeof PromptImprovementResult.Type;
