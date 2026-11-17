// Fork: completing the composer draft as the user types.
import * as Schema from "effect/Schema";

const MAX_DRAFT_CHARS = 8_000;
/** Longest context message the server accepts; clients send the end of a longer one. */
export const DRAFT_COMPLETION_MAX_CONTEXT_CHARS = 8_000;
const MAX_CONTEXT_CHARS = DRAFT_COMPLETION_MAX_CONTEXT_CHARS;

/** The draft to complete, with the thread's latest messages as context. */
export const DraftCompletionInput = Schema.Struct({
  draft: Schema.String.check(Schema.isMaxLength(MAX_DRAFT_CHARS)),
  context: Schema.optionalKey(
    Schema.Struct({
      lastUser: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CONTEXT_CHARS))),
      lastAssistant: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CONTEXT_CHARS))),
    }),
  ),
});
export type DraftCompletionInput = typeof DraftCompletionInput.Type;

/** Text to append to the draft, or null when there is nothing to suggest. */
export const DraftCompletionResult = Schema.Struct({
  completion: Schema.NullOr(Schema.String),
});
export type DraftCompletionResult = typeof DraftCompletionResult.Type;
