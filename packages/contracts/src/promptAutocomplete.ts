import { Schema } from "effect";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MAX_PROMPT_AUTOCOMPLETE_DRAFT_LENGTH = 6_000;
export const MAX_PROMPT_AUTOCOMPLETE_SUGGESTION_LENGTH = 160;

export const PromptAutocompleteSuggestionText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MAX_PROMPT_AUTOCOMPLETE_SUGGESTION_LENGTH),
);
export type PromptAutocompleteSuggestionText = typeof PromptAutocompleteSuggestionText.Type;

export const PromptAutocompleteSuggestion = Schema.Struct({
  text: PromptAutocompleteSuggestionText,
});
export type PromptAutocompleteSuggestion = typeof PromptAutocompleteSuggestion.Type;

export const PromptAutocompleteInput = Schema.Struct({
  threadId: ThreadId,
  draft: Schema.String.check(Schema.isMaxLength(MAX_PROMPT_AUTOCOMPLETE_DRAFT_LENGTH)),
  cursor: NonNegativeInt.check(Schema.isLessThanOrEqualTo(MAX_PROMPT_AUTOCOMPLETE_DRAFT_LENGTH)),
});
export type PromptAutocompleteInput = typeof PromptAutocompleteInput.Type;

export const PromptAutocompleteResult = Schema.Struct({
  suggestions: Schema.Array(PromptAutocompleteSuggestion),
});
export type PromptAutocompleteResult = typeof PromptAutocompleteResult.Type;
