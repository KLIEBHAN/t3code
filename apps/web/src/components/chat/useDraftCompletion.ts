// Fork: completion of the composer draft as the user types (server.completeDraft).
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
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

/** Context for a request from the latest user and assistant message, cut as the extension uses it. */
export const draftCompletionContext = (
  lastUser: string | undefined,
  lastAssistant: string | undefined,
) => ({
  ...(lastUser === undefined
    ? {}
    : { lastUser: keepStartAndEnd(lastUser.trim(), CONTEXT_USER_CHARS) }),
  ...(lastAssistant === undefined
    ? {}
    : { lastAssistant: keepStartAndEnd(lastAssistant.trim(), CONTEXT_ASSISTANT_CHARS) }),
});

export interface DraftCompletionContext {
  readonly lastUser?: string;
  readonly lastAssistant?: string;
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
