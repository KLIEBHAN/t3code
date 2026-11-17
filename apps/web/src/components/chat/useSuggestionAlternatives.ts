// Fork: Ctrl+. and Ctrl+, cycle through alternatives of the composer suggestion.
import { DRAFT_COMPLETION_MAX_ALTERNATIVES, type EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  type DraftCompletionContext,
  type DraftCompletionModel,
  draftCompletionModelFields,
  draftCompletionModelKey,
} from "./useDraftCompletion";

interface Alternatives {
  readonly targetKey: string;
  /** The model they came from; another model drops them. */
  readonly modelKey: string;
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
 * for. `refresh` drops them and asks the model anew, past its cache. `pending` tells whether
 * a request runs; `clear` drops both.
 */
export function useSuggestionAlternatives(input: {
  readonly environmentId: EnvironmentId | null;
  readonly targetKey: string;
  readonly draft: string;
  readonly enabled: boolean;
  /** Pi model to ask; undefined leaves it to the server. */
  readonly model?: DraftCompletionModel | undefined;
  readonly readContext: () => DraftCompletionContext;
}): {
  readonly suggestion: string | null;
  readonly pending: boolean;
  /** A refresh runs; the stale suggestion should not show meanwhile. */
  readonly refreshing: boolean;
  readonly cycle: (direction: 1 | -1, current: string | null) => void;
  readonly refresh: (current: string | null) => void;
  readonly clear: () => void;
} {
  const { environmentId, targetKey, draft, enabled } = input;
  const completeDraft = useAtomCommand(serverEnvironment.completeDraft, {
    reportFailure: false,
    reportDefect: false,
  });
  const [alternatives, setAlternatives] = useState<Alternatives | null>(null);
  const [pending, setPending] = useState(false);
  // The context a refresh runs for; another thread, model, or draft is not hidden by it.
  const [refreshFor, setRefreshFor] = useState<{
    readonly targetKey: string;
    readonly modelKey: string;
    readonly base: string;
  } | null>(null);
  const latestRequest = useRef(0);

  const modelKey = draftCompletionModelKey(input.model);
  const visible =
    enabled &&
    alternatives?.targetKey === targetKey &&
    alternatives.modelKey === modelKey &&
    draft.startsWith(alternatives.base)
      ? continuing(alternatives.prompts, draft)
      : [];
  const suggestion =
    alternatives !== null && visible.includes(alternatives.selected) ? alternatives.selected : null;

  // Asks for alternatives of the draft and lists them after `shown`, the prompt on screen.
  // With `stale`, a refresh shows the first alternative that differs from it.
  const fetchAlternatives = (
    shown: string | null,
    direction: 1 | -1,
    fresh: boolean,
    stale: string | null = null,
  ) => {
    if (environmentId === null) return;
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
        ...(fresh ? { fresh: true } : {}),
        ...draftCompletionModelFields(input.model),
      },
    }).then((result) => {
      // A newer request or a dismissal owns the alternatives now.
      if (request !== latestRequest.current) return;
      setPending(false);
      setRefreshFor(null);
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
          : (choices.find((choice) => choice !== stale) ?? choices[0]);
      if (selected !== undefined) {
        setAlternatives({ targetKey, modelKey, base: asked, prompts, selected });
      }
    });
  };

  const cycle = useStableCallback((direction: 1 | -1, current: string | null) => {
    if (!enabled || environmentId === null) return;
    const shown = suggestion ?? current;
    if (alternatives !== null && visible.length > 1) {
      const position = shown === null ? -1 : visible.indexOf(shown);
      const next = visible[(position + direction + visible.length) % visible.length];
      if (next !== undefined) setAlternatives({ ...alternatives, selected: next });
      return;
    }
    fetchAlternatives(shown, direction, false);
  });

  // Drops what is shown and asks the model anew, past its cache; `current` is the stale
  // suggestion on screen, which the result avoids when it can.
  const refresh = useStableCallback((current: string | null) => {
    if (!enabled || environmentId === null) return;
    const stale = suggestion ?? current;
    setAlternatives(null);
    setRefreshFor({ targetKey, modelKey, base: draft });
    fetchAlternatives(null, 1, true, stale);
  });

  const clear = () => {
    latestRequest.current += 1;
    setAlternatives(null);
    setPending(false);
    setRefreshFor(null);
  };
  const refreshing =
    refreshFor !== null &&
    refreshFor.targetKey === targetKey &&
    refreshFor.modelKey === modelKey &&
    draft === refreshFor.base;
  return { suggestion, pending, refreshing, cycle, refresh, clear };
}
