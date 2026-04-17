import { Schema } from "effect";

import { ThreadId, TurnId, TrimmedNonEmptyString } from "./baseSchemas";

export const DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID = "default";
export const MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID_LENGTH = 128;
export const MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_LABEL_LENGTH = 80;
export const MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_LENGTH = 8_000;

export const ReplySuggestionText = TrimmedNonEmptyString.check(Schema.isMaxLength(160));
export type ReplySuggestionText = typeof ReplySuggestionText.Type;

export const ReplySuggestion = Schema.Struct({
  text: ReplySuggestionText,
});
export type ReplySuggestion = typeof ReplySuggestion.Type;

export const ReplySuggestionsInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  promptTemplateId: Schema.optional(
    Schema.String.check(Schema.isMaxLength(MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID_LENGTH)),
  ),
  promptTemplateInstructions: Schema.optional(
    Schema.String.check(Schema.isMaxLength(MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_LENGTH)),
  ),
});
export type ReplySuggestionsInput = typeof ReplySuggestionsInput.Type;

export const ReplySuggestionsResult = Schema.Struct({
  suggestions: Schema.Array(ReplySuggestion),
});
export type ReplySuggestionsResult = typeof ReplySuggestionsResult.Type;
