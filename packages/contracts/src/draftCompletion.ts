// Fork: completing the composer draft as the user types.
import * as Schema from "effect/Schema";

const MAX_DRAFT_CHARS = 8_000;
/** Longest context message the server accepts; clients send the end of a longer one. */
export const DRAFT_COMPLETION_MAX_CONTEXT_CHARS = 8_000;
const MAX_CONTEXT_CHARS = DRAFT_COMPLETION_MAX_CONTEXT_CHARS;

/** Most alternatives one request may ask for. */
export const DRAFT_COMPLETION_MAX_ALTERNATIVES = 3;

/**
 * The draft to complete, with the thread's latest messages as context.
 * `alternatives` asks for several distinct completions; `manual` marks a request
 * the user made, which also completes an empty draft into a whole prompt; `model`
 * picks the Pi model.
 */
export const DraftCompletionInput = Schema.Struct({
  draft: Schema.String.check(Schema.isMaxLength(MAX_DRAFT_CHARS)),
  alternatives: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: DRAFT_COMPLETION_MAX_ALTERNATIVES })),
  ),
  manual: Schema.optionalKey(Schema.Boolean),
  /** Ask the model again instead of reusing a cached result (extension 0.7.0). */
  fresh: Schema.optionalKey(Schema.Boolean),
  /** Pi provider instance to run the model with; absent uses the first enabled one. */
  instanceId: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  /** Pi model as provider/id; absent uses the server's default. */
  model: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(200), Schema.isPattern(/^[^\s/]+\/\S+$/)),
  ),
  context: Schema.optionalKey(
    Schema.Struct({
      lastUser: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CONTEXT_CHARS))),
      lastAssistant: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_CONTEXT_CHARS))),
    }),
  ),
});
export type DraftCompletionInput = typeof DraftCompletionInput.Type;

/** Texts to append to the draft, best first; `completion` is the first or null. */
export const DraftCompletionResult = Schema.Struct({
  completion: Schema.NullOr(Schema.String),
  completions: Schema.Array(Schema.String),
});
export type DraftCompletionResult = typeof DraftCompletionResult.Type;
