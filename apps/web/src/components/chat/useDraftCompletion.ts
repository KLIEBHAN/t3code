// Fork: completion of the composer draft as the user types (server.completeDraft).
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentThreadDetails } from "../../state/threads";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

/** Pause after the last keystroke before the draft is sent. */
const DEBOUNCE_MS = 350;

/** The Pi model a completion request names, with the provider instance it runs on. */
export interface DraftCompletionModel {
  readonly instanceId: string;
  readonly model: string;
}

/** Identifies a model in answers, so a change of model drops the old one's answer. */
export const draftCompletionModelKey = (model: DraftCompletionModel | undefined) =>
  model === undefined ? "" : `${model.instanceId}\u0000${model.model}`;

/** The request fields for `model`; none leave the choice to the server. */
export const draftCompletionModelFields = (model: DraftCompletionModel | undefined) =>
  model === undefined ? {} : { instanceId: model.instanceId, model: model.model };

// The extension keeps this much of the latest assistant and user message (its
// MAX_LATEST_ASSISTANT_MESSAGE_CHARS and MAX_LATEST_USER_MESSAGE_CHARS); sending more
// only costs transfer.
const CONTEXT_ASSISTANT_CHARS = 3_000;
const CONTEXT_USER_CHARS = 1_200;

/** The start and end of `text` within `maxChars`, like the extension's own cut. */
const keepStartAndEnd = (text: string, maxChars: number) => {
  if (text.length <= maxChars) return text;
  const separator = "\n…\n";
  const head = Math.ceil((maxChars - separator.length) / 2);
  const tail = Math.floor((maxChars - separator.length) / 2);
  return `${text.slice(0, head)}${separator}${text.slice(-tail)}`;
};

/** The user and assistant messages among a thread's turn items, oldest first. */
export const turnItemMessages = (items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>) =>
  items.flatMap(({ item }) =>
    item.type === "user_message"
      ? [{ role: "user", text: item.text, runId: item.runId, streaming: false }]
      : item.type === "assistant_message"
        ? [{ role: "assistant", text: item.text, runId: item.runId, streaming: item.streaming }]
        : [],
  );

/**
 * The thread's messages with their text, read once per request. The composer's timeline
 * entries leave assistant text out, so they cannot supply it.
 */
export const readThreadMessages = (ref: ScopedThreadRef) =>
  turnItemMessages(appAtomRegistry.get(environmentThreadDetails.visibleTurnItemsAtom(ref)));

interface ThreadMessage {
  readonly role: string;
  readonly text: string;
  readonly runId: string | null;
  readonly streaming: boolean;
}

// The extension keeps the newest 6 earlier messages, each from its first 600 characters.
const EARLIER_MESSAGES = 6;
const EARLIER_MESSAGE_CHARS = 1_200;

/**
 * The latest finished answer, its run's user message, and the earlier messages, oldest first.
 * A run a subagent started has no user message; an older one goes only among the earlier ones,
 * which hold user messages and each run's final answer, not the narration before it.
 */
export const latestExchange = (messages: ReadonlyArray<ThreadMessage>) => {
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
  const finalAnswer = new Map<string, ThreadMessage>();
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
};

/** Context for a request from `latestExchange`, cut as the extension uses it. */
export const draftCompletionContext = ({
  lastUser,
  lastAssistant,
  earlier,
}: ReturnType<typeof latestExchange>): DraftCompletionContext => {
  const recent = earlier.flatMap((message): NonNullable<DraftCompletionContext["recent"]> => {
    const role =
      message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : null;
    const text = message.text.trim().slice(0, EARLIER_MESSAGE_CHARS);
    return role === null || text === "" ? [] : [{ role, text }];
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
};

export interface DraftCompletionContext {
  readonly lastUser?: string;
  readonly lastAssistant?: string;
  /** Earlier messages, oldest first; needs pi-prompt-autocomplete 0.9.0, older ones ignore it. */
  readonly recent?: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>;
}

/**
 * Completes `draft` once typing pauses; returns the completed prompt for the ghost text, or null.
 * A change of `targetKey` (the composer's thread or draft) drops pending and shown completions.
 * `readContext` runs only per request; `dismiss` hides the completion until the draft changes.
 */
export function useDraftCompletion(input: {
  readonly environmentId: EnvironmentId | null;
  readonly targetKey: string;
  readonly draft: string;
  readonly enabled: boolean;
  /** Pi model to ask; undefined leaves it to the server. */
  readonly model?: DraftCompletionModel | undefined;
  readonly readContext: () => DraftCompletionContext;
}): { readonly suggestion: string | null; readonly dismiss: () => void } {
  const { environmentId, targetKey, draft, enabled, model } = input;
  const completeDraft = useAtomCommand(serverEnvironment.completeDraft, {
    reportFailure: false,
    reportDefect: false,
  });
  const [answered, setAnswered] = useState<{
    readonly targetKey: string;
    readonly modelKey: string;
    readonly text: string;
  } | null>(null);
  const modelKey = draftCompletionModelKey(model);
  const latestRequest = useRef(0);
  const active = enabled && environmentId !== null && draft.trim().length > 0;
  const request = useStableCallback((target: EnvironmentId, text: string) =>
    completeDraft({
      environmentId: target,
      input: { draft: text, context: input.readContext(), ...draftCompletionModelFields(model) },
    }),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces a network request for the typed draft
  useEffect(() => {
    const id = ++latestRequest.current;
    if (!active || environmentId === null) return;
    const timer = setTimeout(() => {
      void request(environmentId, draft).then((result) => {
        // A newer keystroke owns the ghost text now.
        if (id !== latestRequest.current) return;
        const completion = result._tag === "Success" ? result.value.completion : null;
        setAnswered(completion ? { targetKey, modelKey, text: draft + completion } : null);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, draft, environmentId, modelKey, request, targetKey]);

  const dismiss = () => {
    latestRequest.current += 1;
    setAnswered(null);
  };
  const shown =
    active && answered?.targetKey === targetKey && answered.modelKey === modelKey
      ? answered.text
      : null;
  return { suggestion: shown, dismiss };
}
