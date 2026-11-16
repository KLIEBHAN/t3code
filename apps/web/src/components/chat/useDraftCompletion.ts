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
 * Asks the server to complete `draft` once typing pauses and returns the
 * completed prompt (the draft it answered plus the completion) for the
 * composer's ghost text, or null. `readContext` runs only when a request goes
 * out. `dismiss` hides the completion until the draft changes.
 */
export function useDraftCompletion(input: {
  readonly environmentId: EnvironmentId | null;
  readonly draft: string;
  readonly enabled: boolean;
  readonly readContext: () => DraftCompletionContext;
}): { readonly suggestion: string | null; readonly dismiss: () => void } {
  const { environmentId, draft, enabled } = input;
  const completeDraft = useAtomCommand(serverEnvironment.completeDraft, {
    reportFailure: false,
    reportDefect: false,
  });
  const [answered, setAnswered] = useState<{
    readonly draft: string;
    readonly text: string;
  } | null>(null);
  const latestRequest = useRef(0);
  const active = enabled && environmentId !== null && draft.trim().length > 0;
  const request = useStableCallback((target: EnvironmentId, text: string) =>
    completeDraft({ environmentId: target, input: { draft: text, context: input.readContext() } }),
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
        setAnswered(completion ? { draft, text: draft + completion } : null);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, draft, environmentId, request]);

  const dismiss = () => {
    latestRequest.current += 1;
    setAnswered(null);
  };
  return { suggestion: active ? (answered?.text ?? null) : null, dismiss };
}
