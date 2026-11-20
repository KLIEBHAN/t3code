// Fork: pure prompt-suggestion and draft-completion logic for the mobile composer.
import { announcedRun } from "@t3tools/client-runtime/state/thread-activity-announcement";
import type {
  ModelSelection,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2Run,
  RunId,
  ServerSettings,
} from "@t3tools/contracts";

/** The Pi model a completion request names, with the provider instance it runs on. */
export interface DraftCompletionModel {
  readonly instanceId: string;
  readonly model: string;
}

export interface DraftCompletionContext {
  readonly lastUser?: string;
  readonly lastAssistant?: string;
  /** Earlier messages, oldest first; needs pi-prompt-autocomplete 0.9.0, older ones ignore it. */
  readonly recent?: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>;
}

export interface ThreadCompletionMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly runId: string | null;
  readonly streaming: boolean;
}

export interface SuggestionPreview {
  /** Trailing fragment of the draft's unfinished word, shown muted before `remainder`. */
  readonly prefix: string;
  /** New text the suggestion adds beyond the draft. */
  readonly remainder: string;
}

// Match the pi-prompt-autocomplete extension limits so transfer stays bounded.
const CONTEXT_ASSISTANT_CHARS = 3_000;
const CONTEXT_USER_CHARS = 1_200;
const EARLIER_MESSAGES = 6;
const EARLIER_MESSAGE_CHARS = 1_200;

/** The part of `suggestion` still to type beyond `draft`, or null when it does not continue `draft`. */
export function composerSuggestionRemainder(
  draft: string,
  suggestion: string | null,
): string | null {
  if (suggestion === null || suggestion.length <= draft.length) return null;
  if (draft.length === 0) return suggestion;
  return suggestion.startsWith(draft) ? suggestion.slice(draft.length) : null;
}

/** The next word of `remainder` with any leading whitespace, for word-by-word acceptance. */
export function nextComposerSuggestionWord(remainder: string): string {
  return /^\s*\S+/.exec(remainder)?.[0] ?? remainder;
}

/**
 * Formats `suggestion` for display in the suggestion bar. Mid-word completions keep the
 * draft's unfinished word prefix muted so the preview never starts with a severed fragment.
 */
export function formatSuggestionPreview(
  draft: string,
  suggestion: string | null,
): SuggestionPreview | null {
  const rawRemainder = composerSuggestionRemainder(draft, suggestion);
  if (rawRemainder === null) return null;
  if (draft.length === 0) {
    const trimmed = rawRemainder.trim();
    return trimmed.length > 0 ? { prefix: "", remainder: trimmed } : null;
  }
  const startsFreshWord = /\s$/.test(draft) || /^\s/.test(rawRemainder);
  if (startsFreshWord) {
    const trimmed = rawRemainder.trimStart();
    return trimmed.length > 0 ? { prefix: "", remainder: trimmed } : null;
  }
  const prefix = /\S+$/.exec(draft)?.[0] ?? "";
  return { prefix, remainder: rawRemainder };
}

/** Identifies a model in cached answers, so changing the model drops stale completions. */
export function draftCompletionModelKey(model: DraftCompletionModel | undefined): string {
  return model === undefined ? "" : `${model.instanceId}\u0000${model.model}`;
}

/** The request fields for `model`; omitted fields leave the choice to the server. */
export function draftCompletionModelFields(
  model: DraftCompletionModel | undefined,
): { readonly instanceId: string; readonly model: string } | Record<string, never> {
  return model === undefined ? {} : { instanceId: model.instanceId, model: model.model };
}

/** Resolves the Pi completion model from Labs settings, else the thread's Pi model, else server default. */
export function resolveDraftCompletionModel(input: {
  readonly serverSettings: Pick<
    ServerSettings,
    "draftCompletionModel" | "draftCompletionInstanceId"
  > | null;
  readonly selectedProviderDriver: string | null;
  readonly selectedModelSelection: Pick<ModelSelection, "instanceId" | "model">;
}): DraftCompletionModel | undefined {
  const configuredModel = input.serverSettings?.draftCompletionModel?.trim() ?? "";
  const configuredInstance = input.serverSettings?.draftCompletionInstanceId?.trim() ?? "";
  if (configuredModel !== "" && configuredInstance !== "") {
    return { instanceId: configuredInstance, model: configuredModel };
  }
  if (input.selectedProviderDriver === "pi" && input.selectedModelSelection.model.includes("/")) {
    return {
      instanceId: String(input.selectedModelSelection.instanceId),
      model: input.selectedModelSelection.model,
    };
  }
  return undefined;
}

/**
 * The suggestion while the run that produced it is the thread's latest completed run.
 * Mirrors apps/web/src/components/chat/usePromptSuggestion.ts.
 */
export function offeredPromptSuggestion<Suggestion extends { readonly runId: RunId }>(
  suggestion: Suggestion | null | undefined,
  latestRun: Parameters<typeof announcedRun>[0],
  runs: ReadonlyArray<OrchestrationV2Run>,
): Suggestion | null {
  const run = announcedRun(latestRun ?? null, runs);
  const skippedUnseenRun =
    latestRun != null &&
    run?.runId !== latestRun.runId &&
    !runs.some(
      (candidate) =>
        candidate.id === latestRun.runId &&
        candidate.status === "cancelled" &&
        candidate.startedAt === null,
    );
  return suggestion &&
    !skippedUnseenRun &&
    run?.runId === suggestion.runId &&
    run.status === "completed"
    ? suggestion
    : null;
}

const keepStartAndEnd = (text: string, maxChars: number) => {
  if (text.length <= maxChars) return text;
  const separator = "\n…\n";
  const head = Math.ceil((maxChars - separator.length) / 2);
  const tail = Math.floor((maxChars - separator.length) / 2);
  return `${text.slice(0, head)}${separator}${text.slice(-tail)}`;
};

/** The user and assistant messages among a thread's turn items, oldest first. */
export function turnItemMessages(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ThreadCompletionMessage[] {
  return items.flatMap(({ item }): ThreadCompletionMessage[] =>
    item.type === "user_message"
      ? [{ role: "user", text: item.text, runId: item.runId, streaming: false }]
      : item.type === "assistant_message"
        ? [
            {
              role: "assistant",
              text: item.text,
              runId: item.runId,
              streaming: item.streaming,
            },
          ]
        : [],
  );
}

/**
 * The latest finished answer, its run's user message, and up to six earlier messages, oldest first.
 * A run started by a subagent or schedule has no user message; earlier assistant entries keep only
 * each run's final answer.
 */
export function latestExchange(messages: ReadonlyArray<ThreadCompletionMessage>) {
  const assistantIndex = messages.findLastIndex(
    (message) => message.role === "assistant" && !message.streaming,
  );
  const assistant = messages[assistantIndex];
  const user =
    assistant?.runId == null
      ? undefined
      : messages.findLast(
          (message) => message.role === "user" && message.runId === assistant.runId,
        );
  const before = assistantIndex === -1 ? [] : messages.slice(0, assistantIndex);
  const finalAnswer = new Map<string, ThreadCompletionMessage>();
  for (const message of [...before, assistant]) {
    if (message?.role === "assistant" && message.runId !== null) {
      finalAnswer.set(message.runId, message);
    }
  }
  const earlier = before.filter(
    (message) =>
      message !== user &&
      !message.streaming &&
      message.text.trim() !== "" &&
      (message.role === "user" ||
        message.runId === null ||
        finalAnswer.get(message.runId) === message),
  );
  return {
    lastUser: user?.text,
    lastAssistant: assistant?.text,
    earlier: earlier.slice(-EARLIER_MESSAGES),
  };
}

/** Context for `server.completeDraft` from `latestExchange`, cut to the extension's limits. */
export function draftCompletionContext({
  lastUser,
  lastAssistant,
  earlier,
}: ReturnType<typeof latestExchange>): DraftCompletionContext {
  const recent = earlier.flatMap((message): NonNullable<DraftCompletionContext["recent"]> => {
    const text = message.text.trim().slice(0, EARLIER_MESSAGE_CHARS);
    return text === "" ? [] : [{ role: message.role, text }];
  });
  return {
    ...(lastUser === undefined
      ? {}
      : { lastUser: keepStartAndEnd(lastUser.trim(), CONTEXT_USER_CHARS) }),
    ...(lastAssistant === undefined
      ? {}
      : { lastAssistant: keepStartAndEnd(lastAssistant.trim(), CONTEXT_ASSISTANT_CHARS) }),
    ...(recent.length === 0 ? {} : { recent }),
  };
}
