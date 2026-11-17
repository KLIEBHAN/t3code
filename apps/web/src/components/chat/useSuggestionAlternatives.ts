// Fork: Ctrl+. and Ctrl+, cycle through alternatives of the composer suggestion.
import { DRAFT_COMPLETION_MAX_ALTERNATIVES, type EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { DraftCompletionContext } from "./useDraftCompletion";

interface Alternatives {
  readonly targetKey: string;
  /** The draft they were asked for; a draft that no longer starts with it drops them. */
  readonly base: string;
  readonly prompts: ReadonlyArray<string>;
  readonly selected: string;
}

/** The prompts in `prompts` that `draft` starts and that add to it. */
const continuing = (prompts: ReadonlyArray<string>, draft: string) =>
  prompts.filter((prompt) => prompt.length > draft.length && prompt.startsWith(draft));

/**
 * The first `cycle` asks for alternatives and lists them after `current`, the suggestion on
 * screen; later calls step through them while the draft continues the text they were asked
 * for. `pending` tells whether a request runs; `clear` drops both.
 */
export function useSuggestionAlternatives(input: {
  readonly environmentId: EnvironmentId | null;
  readonly targetKey: string;
  readonly draft: string;
  readonly enabled: boolean;
  /** Pi model as provider/id; undefined leaves it to the server. */
  readonly model?: string | undefined;
  readonly readContext: () => DraftCompletionContext;
}): {
  readonly suggestion: string | null;
  readonly pending: boolean;
  readonly cycle: (direction: 1 | -1, current: string | null) => void;
  readonly clear: () => void;
} {
  const { environmentId, targetKey, draft, enabled } = input;
  const completeDraft = useAtomCommand(serverEnvironment.completeDraft, {
    reportFailure: false,
    reportDefect: false,
  });
  const [alternatives, setAlternatives] = useState<Alternatives | null>(null);
  const [pending, setPending] = useState(false);
  const latestRequest = useRef(0);

  const visible =
    enabled && alternatives?.targetKey === targetKey && draft.startsWith(alternatives.base)
      ? continuing(alternatives.prompts, draft)
      : [];
  const suggestion =
    alternatives !== null && visible.includes(alternatives.selected) ? alternatives.selected : null;

  const cycle = useStableCallback((direction: 1 | -1, current: string | null) => {
    if (!enabled || environmentId === null) return;
    const shown = suggestion ?? current;
    if (alternatives !== null && visible.length > 1) {
      const position = shown === null ? -1 : visible.indexOf(shown);
      const next = visible[(position + direction + visible.length) % visible.length];
      if (next !== undefined) setAlternatives({ ...alternatives, selected: next });
      return;
    }
    const request = ++latestRequest.current;
    const asked = draft;
    setPending(true);
    void completeDraft({
      environmentId,
      input: {
        draft: asked,
        context: input.readContext(),
        alternatives: DRAFT_COMPLETION_MAX_ALTERNATIVES,
        manual: true,
        ...(input.model ? { model: input.model } : {}),
      },
    }).then((result) => {
      // A newer request or a dismissal owns the alternatives now.
      if (request !== latestRequest.current) return;
      setPending(false);
      if (result._tag !== "Success") return;
      const prompts = [
        ...new Set([
          ...(shown === null ? [] : [shown]),
          ...result.value.completions.map((completion) => asked + completion),
        ]),
      ];
      const choices = continuing(prompts, asked);
      if (choices.length === 0) return;
      // Step away from the prompt on screen; without one, show the first alternative.
      const selected =
        shown !== null && choices.length > 1
          ? (choices[direction === 1 ? 1 : choices.length - 1] ?? choices[0])
          : choices[0];
      if (selected !== undefined) setAlternatives({ targetKey, base: asked, prompts, selected });
    });
  });

  const clear = () => {
    latestRequest.current += 1;
    setAlternatives(null);
    setPending(false);
  };
  return { suggestion, pending, cycle, clear };
}
