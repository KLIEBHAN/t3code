// Fork: completion of the composer draft as the user types (server.completeDraft).
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

/** Pause after the last keystroke before the draft is sent. */
const DEBOUNCE_MS = 350;

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
  /** Pi model as provider/id; undefined leaves it to the server. */
  readonly model?: string | undefined;
  readonly readContext: () => DraftCompletionContext;
}): { readonly suggestion: string | null; readonly dismiss: () => void } {
  const { environmentId, targetKey, draft, enabled, model } = input;
  const completeDraft = useAtomCommand(serverEnvironment.completeDraft, {
    reportFailure: false,
    reportDefect: false,
  });
  const [answered, setAnswered] = useState<{
    readonly targetKey: string;
    readonly text: string;
  } | null>(null);
  const latestRequest = useRef(0);
  const active = enabled && environmentId !== null && draft.trim().length > 0;
  const request = useStableCallback((target: EnvironmentId, text: string) =>
    completeDraft({
      environmentId: target,
      input: { draft: text, context: input.readContext(), ...(model ? { model } : {}) },
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
        setAnswered(completion ? { targetKey, text: draft + completion } : null);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, draft, environmentId, request, targetKey]);

  const dismiss = () => {
    latestRequest.current += 1;
    setAnswered(null);
  };
  const shown = active && answered?.targetKey === targetKey ? answered.text : null;
  return { suggestion: shown, dismiss };
}
