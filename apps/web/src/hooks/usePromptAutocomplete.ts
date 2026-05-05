import type {
  EnvironmentId,
  ModelSelection,
  PromptAutocompleteInput,
  PromptAutocompleteSuggestion,
} from "@t3tools/contracts";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  promptAutocompleteQueryOptions,
  prunePromptAutocompleteQueryCache,
} from "../lib/promptAutocompleteReactQuery";

const PROMPT_AUTOCOMPLETE_DEBOUNCE_MS = 350;
const EMPTY_SUGGESTIONS: readonly PromptAutocompleteSuggestion[] = [];
const EMPTY_STATE: PromptAutocompleteState = {
  selectedIndex: 0,
  suggestions: EMPTY_SUGGESTIONS,
};

interface LatestPromptAutocompleteRequest {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly key: string | null;
  readonly modelSelection: ModelSelection | null;
  readonly request: PromptAutocompleteInput | null;
  readonly dismissedKey: string | null;
}

interface PromptAutocompleteState {
  readonly selectedIndex: number;
  readonly suggestions: readonly PromptAutocompleteSuggestion[];
}

export function getNextPromptAutocompleteIndex(input: {
  currentIndex: number;
  direction: 1 | -1;
  suggestionCount: number;
}): number {
  if (input.suggestionCount <= 0) return 0;
  return (input.currentIndex + input.direction + input.suggestionCount) % input.suggestionCount;
}

export function resolvePromptAutocompleteSelectedIndex(input: {
  currentSuggestion: PromptAutocompleteSuggestion | undefined;
  nextSuggestions: readonly PromptAutocompleteSuggestion[];
}): number {
  if (input.nextSuggestions.length === 0) return 0;
  if (!input.currentSuggestion) return 0;
  const preservedIndex = input.nextSuggestions.findIndex(
    (suggestion) => suggestion.text === input.currentSuggestion?.text,
  );
  return preservedIndex >= 0 ? preservedIndex : 0;
}

function modelSelectionKey(modelSelection: ModelSelection | null): string {
  if (!modelSelection) return "";
  return `${modelSelection.instanceId}\u001f${modelSelection.model}\u001f${JSON.stringify(
    modelSelection.options ?? null,
  )}`;
}

function requestKey(
  environmentId: EnvironmentId | null | undefined,
  input: PromptAutocompleteInput | null,
  modelSelection: ModelSelection | null,
): string | null {
  if (!input) return null;
  return `${environmentId ?? ""}\u001f${input.threadId}\u001f${input.cursor}\u001f${
    input.draft
  }\u001f${modelSelectionKey(modelSelection)}`;
}

export function usePromptAutocomplete(input: {
  environmentId: EnvironmentId | null | undefined;
  request: PromptAutocompleteInput | null;
  modelSelection: ModelSelection | null;
}) {
  const queryClient = useQueryClient();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [state, setState] = useState<PromptAutocompleteState>(EMPTY_STATE);
  const [debouncedRequest, requestDebouncer] = useDebouncedValue(
    input.request,
    { wait: PROMPT_AUTOCOMPLETE_DEBOUNCE_MS },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const currentKey = requestKey(input.environmentId, input.request, input.modelSelection);
  const debouncedKey = requestKey(input.environmentId, debouncedRequest, input.modelSelection);
  const effectiveRequest = currentKey === debouncedKey ? debouncedRequest : null;
  const effectiveKey = currentKey === debouncedKey ? currentKey : null;
  const latestRequestRef = useRef<LatestPromptAutocompleteRequest>({
    dismissedKey: null,
    environmentId: null,
    key: null,
    modelSelection: null,
    request: null,
  });
  const inFlightKeyRef = useRef<string | null>(null);
  const runLatestRequestRef = useRef<() => void>(() => undefined);

  const setSuggestions = useCallback((nextSuggestions: readonly PromptAutocompleteSuggestion[]) => {
    setState((current) => ({
      suggestions: nextSuggestions,
      selectedIndex: resolvePromptAutocompleteSelectedIndex({
        currentSuggestion: current.suggestions[current.selectedIndex],
        nextSuggestions,
      }),
    }));
  }, []);

  const clearSuggestions = useCallback(() => {
    setState(EMPTY_STATE);
  }, []);

  const runLatestRequest = useCallback(() => {
    if (inFlightKeyRef.current !== null) {
      return;
    }

    const latest = latestRequestRef.current;
    if (
      !latest.key ||
      !latest.environmentId ||
      !latest.request ||
      latest.key === latest.dismissedKey
    ) {
      setIsFetching(false);
      return;
    }

    const keyAtStart = latest.key;
    inFlightKeyRef.current = keyAtStart;
    setIsFetching(true);
    prunePromptAutocompleteQueryCache(queryClient);

    void queryClient
      .fetchQuery(
        promptAutocompleteQueryOptions(latest.environmentId, latest.request, latest.modelSelection),
      )
      .then((result) => {
        const current = latestRequestRef.current;
        if (current.key === keyAtStart && current.dismissedKey !== keyAtStart) {
          setSuggestions(result.suggestions);
        }
      })
      .catch(() => {
        if (latestRequestRef.current.key === keyAtStart) {
          clearSuggestions();
        }
      })
      .finally(() => {
        inFlightKeyRef.current = null;
        const current = latestRequestRef.current;
        if (current.key && current.key !== keyAtStart && current.key !== current.dismissedKey) {
          queueMicrotask(() => runLatestRequestRef.current());
          return;
        }
        setIsFetching(false);
      });
  }, [clearSuggestions, queryClient, setSuggestions]);

  useEffect(() => {
    runLatestRequestRef.current = runLatestRequest;
  }, [runLatestRequest]);

  useEffect(() => {
    latestRequestRef.current = {
      dismissedKey,
      environmentId: input.environmentId,
      key: effectiveKey,
      modelSelection: input.modelSelection,
      request: effectiveRequest,
    };

    if (!effectiveKey || effectiveKey === dismissedKey) {
      clearSuggestions();
    }

    runLatestRequestRef.current();
  }, [
    clearSuggestions,
    dismissedKey,
    effectiveKey,
    effectiveRequest,
    input.environmentId,
    input.modelSelection,
  ]);

  const dismiss = useCallback(() => {
    latestRequestRef.current = {
      ...latestRequestRef.current,
      dismissedKey: currentKey,
    };
    setDismissedKey(currentKey);
    clearSuggestions();
  }, [clearSuggestions, currentKey]);

  const cycle = useCallback(
    (direction: 1 | -1): boolean => {
      if (state.suggestions.length <= 1) return false;
      setState((current) => {
        if (current.suggestions.length <= 1) return current;
        const selectedIndex = getNextPromptAutocompleteIndex({
          currentIndex: current.selectedIndex,
          direction,
          suggestionCount: current.suggestions.length,
        });
        if (selectedIndex === current.selectedIndex) return current;
        return {
          ...current,
          selectedIndex,
        };
      });
      return true;
    },
    [state.suggestions.length],
  );

  const selectedSuggestion = state.suggestions[state.selectedIndex] ?? null;
  const hasVisibleRequest = Boolean(currentKey && currentKey !== dismissedKey);
  const isLoading = hasVisibleRequest && (isFetching || requestDebouncer.state.isPending);

  return {
    canCycle: state.suggestions.length > 1,
    cycleNext: () => cycle(1),
    cyclePrevious: () => cycle(-1),
    dismiss,
    isFetching,
    isLoading,
    selectedIndex: selectedSuggestion ? state.selectedIndex : 0,
    selectedOrdinal: selectedSuggestion ? state.selectedIndex + 1 : 0,
    suggestion: selectedSuggestion?.text ?? null,
    suggestionCount: state.suggestions.length,
    suggestions: state.suggestions,
  };
}
