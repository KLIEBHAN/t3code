// Fork: mobile hook combining next-prompt suggestions, debounced draft completion, and alternatives.
import {
  DRAFT_COMPLETION_MAX_ALTERNATIVES,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationV2Run,
  type RunId,
  type ScopedThreadRef,
  type ServerConfig,
  type ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentThreadDetails } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useQuietThreadStructure } from "../../state/use-thread-detail";
import {
  composerSuggestionRemainder,
  draftCompletionContext,
  draftCompletionModelFields,
  draftCompletionModelKey,
  latestExchange,
  nextComposerSuggestionWord,
  offeredPromptSuggestion,
  resolveDraftCompletionModel,
  turnItemMessages,
} from "./composerSuggestions";

const DEBOUNCE_MS = 350;
const EMPTY_RUNS: ReadonlyArray<OrchestrationV2Run> = [];

// Dismissed next-prompt suggestions, keyed by environment and run, survive screen remounts.
let dismissedPromptKeys: ReadonlySet<string> = new Set();
const dismissedListeners = new Set<() => void>();
const subscribeDismissed = (listener: () => void) => {
  dismissedListeners.add(listener);
  return () => dismissedListeners.delete(listener);
};
const readDismissed = () => dismissedPromptKeys;
const promptDismissKey = (environmentId: EnvironmentId, runId: RunId) =>
  `${environmentId}\u0000${runId}`;

/** Test helper: resets module-scoped dismissed next-prompt keys. */
export function resetDismissedMobilePromptSuggestionsForTests(): void {
  dismissedPromptKeys = new Set();
  for (const listener of dismissedListeners) listener();
}

interface DraftAnswer {
  readonly draftKey: string;
  readonly modelKey: string;
  readonly text: string;
}

interface AlternativesState {
  readonly draftKey: string;
  readonly modelKey: string;
  readonly base: string;
  readonly prompts: ReadonlyArray<string>;
  readonly selected: string;
}

interface RequestScope {
  readonly draftKey: string;
  readonly modelKey: string;
  readonly base: string;
}

interface SuppressedDraft {
  readonly draftKey: string;
  readonly draft: string;
}

const continuingPrompts = (prompts: ReadonlyArray<string>, draft: string) =>
  prompts.filter((prompt) => prompt.length > draft.length && prompt.startsWith(draft));

export interface UseComposerSuggestionsInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadDetailRef: ScopedThreadRef | null;
  readonly latestRun: EnvironmentThreadShell["latestRun"];
  readonly draftKey: string;
  readonly draft: string;
  readonly serverConfig: ServerConfig | null;
  readonly selectedProviderDriver: string | null;
  readonly selectedModelSelection: ModelSelection;
  /** True when the composer can show suggestions at all (manual refresh also works mid-turn). */
  readonly allowsSuggestions: boolean;
  /** True when automatic suggestions (next-prompt + debounced draft completion) may run. */
  readonly offersAutomaticSuggestions: boolean;
}

export interface ComposerSuggestionsState {
  readonly suggestion: string | null;
  readonly remainder: string | null;
  /** Present only when accepting one word leaves more suggestion text afterwards. */
  readonly nextWord: string | null;
  readonly pending: boolean;
  readonly alternativeIndex: number | null;
  readonly alternativeCount: number;
  readonly acceptAll: () => string | null;
  readonly acceptNextWord: () => string | null;
  readonly cycle: () => void;
  readonly refresh: () => void;
  readonly dismiss: () => void;
  readonly clear: () => void;
}

export function useComposerSuggestions(
  input: UseComposerSuggestionsInput,
): ComposerSuggestionsState {
  const {
    environmentId,
    threadId,
    threadDetailRef,
    latestRun,
    draftKey,
    draft,
    serverConfig,
    selectedProviderDriver,
    selectedModelSelection,
    allowsSuggestions,
    offersAutomaticSuggestions,
  } = input;

  const serverSettings = serverConfig?.settings ?? null;
  const promptSuggestionsEnabled = serverSettings?.promptSuggestionsEnabled === true;
  const model = resolveDraftCompletionModel({
    serverSettings,
    selectedProviderDriver,
    selectedModelSelection,
  });
  const modelKey = draftCompletionModelKey(model);

  const quietStructure = useQuietThreadStructure(promptSuggestionsEnabled ? threadDetailRef : null);
  const runs = quietStructure?.projection.runs ?? EMPTY_RUNS;
  const { data: promptSuggestionData } = useEnvironmentQuery(
    promptSuggestionsEnabled && threadDetailRef !== null && latestRun != null
      ? orchestrationEnvironment.v2.promptSuggestion({
          environmentId,
          input: { threadId },
        })
      : null,
  );
  const dismissedKeys = useSyncExternalStore(subscribeDismissed, readDismissed);
  const offeredNextPrompt = offeredPromptSuggestion(promptSuggestionData, latestRun, runs);
  const rawNextPrompt =
    offeredNextPrompt &&
    !dismissedKeys.has(promptDismissKey(environmentId, offeredNextPrompt.runId))
      ? offeredNextPrompt.text
      : null;
  const offeredPromptText = offersAutomaticSuggestions ? rawNextPrompt : null;
  const nextPromptGhost =
    offeredPromptText !== null && composerSuggestionRemainder(draft, offeredPromptText) !== null
      ? offeredPromptText
      : null;

  const completeDraft = useAtomCommand(serverEnvironment.completeDraft, {
    reportFailure: false,
    reportDefect: false,
  });

  const [draftAnswer, setDraftAnswer] = useState<DraftAnswer | null>(null);
  const [suppressedDraft, setSuppressedDraft] = useState<SuppressedDraft | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativesState | null>(null);
  const [pendingFor, setPendingFor] = useState<RequestScope | null>(null);
  const [refreshFor, setRefreshFor] = useState<RequestScope | null>(null);

  const latestDraftRequestRef = useRef(0);
  const latestAltRequestRef = useRef(0);
  const altScopeKeyRef = useRef("");

  const readContext = () => {
    if (threadDetailRef === null) return {};
    const items = appAtomRegistry.get(
      environmentThreadDetails.visibleTurnItemsAtom(threadDetailRef),
    );
    return draftCompletionContext(latestExchange(turnItemMessages(items)));
  };

  const isDraftSuppressed =
    suppressedDraft !== null &&
    suppressedDraft.draftKey === draftKey &&
    suppressedDraft.draft === draft;

  const visibleAlternatives =
    promptSuggestionsEnabled &&
    allowsSuggestions &&
    alternatives !== null &&
    alternatives.draftKey === draftKey &&
    alternatives.modelKey === modelKey &&
    draft.startsWith(alternatives.base)
      ? continuingPrompts(alternatives.prompts, draft)
      : [];

  const activeAlternative =
    alternatives !== null && visibleAlternatives.includes(alternatives.selected)
      ? alternatives.selected
      : null;

  const pending =
    promptSuggestionsEnabled &&
    allowsSuggestions &&
    pendingFor !== null &&
    pendingFor.draftKey === draftKey &&
    pendingFor.modelKey === modelKey &&
    draft.startsWith(pendingFor.base);

  const refreshing =
    refreshFor !== null &&
    refreshFor.draftKey === draftKey &&
    refreshFor.modelKey === modelKey &&
    draft === refreshFor.base;

  const matchingDraftAnswer =
    promptSuggestionsEnabled &&
    offersAutomaticSuggestions &&
    nextPromptGhost === null &&
    !isDraftSuppressed &&
    draft.trim().length > 0 &&
    draftAnswer !== null &&
    draftAnswer.draftKey === draftKey &&
    draftAnswer.modelKey === modelKey &&
    composerSuggestionRemainder(draft, draftAnswer.text) !== null
      ? draftAnswer.text
      : null;

  const autoDraftActive =
    promptSuggestionsEnabled &&
    offersAutomaticSuggestions &&
    nextPromptGhost === null &&
    activeAlternative === null &&
    !pending &&
    !refreshing &&
    !isDraftSuppressed &&
    draft.trim().length > 0 &&
    matchingDraftAnswer === null;

  const requestDraftCompletion = useEffectEvent(
    (targetEnvironmentId: EnvironmentId, targetDraft: string) =>
      completeDraft({
        environmentId: targetEnvironmentId,
        input: {
          draft: targetDraft,
          context: readContext(),
          ...draftCompletionModelFields(model),
        },
      }),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels in-flight manual requests and clears their pending scopes on unmount or when switching thread/model
  useEffect(() => {
    altScopeKeyRef.current = `${environmentId}\u0000${draftKey}\u0000${modelKey}`;
    return () => {
      latestAltRequestRef.current += 1;
      setPendingFor(null);
      setRefreshFor(null);
    };
  }, [draftKey, environmentId, modelKey]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces a network completion request as the user pauses typing
  useEffect(() => {
    const requestId = ++latestDraftRequestRef.current;
    if (!autoDraftActive) return;
    const timer = setTimeout(() => {
      void requestDraftCompletion(environmentId, draft).then((result) => {
        if (requestId !== latestDraftRequestRef.current) return;
        const completion = result._tag === "Success" ? result.value.completion : null;
        setDraftAnswer(completion ? { draftKey, modelKey, text: draft + completion } : null);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [autoDraftActive, draft, draftKey, environmentId, modelKey]);

  const suggestion = refreshing
    ? null
    : (activeAlternative ?? nextPromptGhost ?? matchingDraftAnswer);
  const remainder = composerSuggestionRemainder(draft, suggestion);
  const candidateWord = remainder === null ? null : nextComposerSuggestionWord(remainder);
  const nextWord =
    remainder !== null && candidateWord !== null && candidateWord.length < remainder.length
      ? candidateWord
      : null;

  const alternativeIndex =
    activeAlternative !== null && visibleAlternatives.length > 1
      ? visibleAlternatives.indexOf(activeAlternative)
      : null;
  const alternativeCount = alternativeIndex !== null ? visibleAlternatives.length : 0;

  const fetchAlternatives = (
    shown: string | null,
    fresh: boolean,
    stale: string | null = null,
    allowFreshFallback = false,
  ) => {
    const requestId = ++latestAltRequestRef.current;
    const asked = draft;
    setPendingFor({ draftKey, modelKey, base: asked });
    void completeDraft({
      environmentId,
      input: {
        draft: asked,
        context: readContext(),
        alternatives: DRAFT_COMPLETION_MAX_ALTERNATIVES,
        manual: true,
        ...(fresh ? { fresh: true } : {}),
        ...draftCompletionModelFields(model),
      },
    }).then((result) => {
      if (requestId !== latestAltRequestRef.current) return;
      if (result._tag !== "Success") {
        setPendingFor(null);
        setRefreshFor(null);
        return;
      }
      const prompts = [
        ...new Set([
          ...(shown === null ? [] : [shown]),
          ...result.value.completions.map((completion) => asked + completion),
        ]),
      ];
      const choices = continuingPrompts(prompts, asked);
      // If cached alternatives gave nothing different from what is on screen, retry once past cache.
      if (allowFreshFallback && !fresh && shown !== null && choices.length <= 1) {
        fetchAlternatives(null, true, shown, false);
        return;
      }
      setPendingFor(null);
      setRefreshFor(null);
      if (choices.length === 0) return;
      const selected =
        shown !== null && choices.length > 1
          ? (choices[1] ?? choices[0])
          : (choices.find((choice) => choice !== stale) ?? choices[0]);
      if (selected !== undefined) {
        setAlternatives({ draftKey, modelKey, base: asked, prompts, selected });
      }
    });
  };

  const clear = () => {
    latestDraftRequestRef.current += 1;
    latestAltRequestRef.current += 1;
    setDraftAnswer(null);
    setAlternatives(null);
    setPendingFor(null);
    setRefreshFor(null);
  };

  const dismissPromptSuggestion = () => {
    if (offeredNextPrompt === null) return;
    dismissedPromptKeys = new Set(dismissedPromptKeys).add(
      promptDismissKey(environmentId, offeredNextPrompt.runId),
    );
    for (const listener of dismissedListeners) listener();
  };

  const dismiss = () => {
    latestDraftRequestRef.current += 1;
    latestAltRequestRef.current += 1;
    setAlternatives(null);
    setPendingFor(null);
    setRefreshFor(null);
    setDraftAnswer(null);
    setSuppressedDraft({ draftKey, draft });
    if (nextPromptGhost !== null) dismissPromptSuggestion();
  };

  const cycle = () => {
    if (!promptSuggestionsEnabled || !allowsSuggestions) return;
    setSuppressedDraft(null);
    const shown = activeAlternative ?? suggestion;
    if (alternatives !== null && visibleAlternatives.length > 1) {
      const position = shown === null ? -1 : visibleAlternatives.indexOf(shown);
      const next = visibleAlternatives[(position + 1) % visibleAlternatives.length];
      if (next !== undefined) setAlternatives({ ...alternatives, selected: next });
      return;
    }
    fetchAlternatives(shown, false, shown, true);
  };

  const refresh = () => {
    if (!promptSuggestionsEnabled || !allowsSuggestions) return;
    const stale = activeAlternative ?? suggestion ?? offeredPromptText;
    setSuppressedDraft(null);
    setAlternatives(null);
    setRefreshFor({ draftKey, modelKey, base: draft });
    fetchAlternatives(null, true, stale, false);
  };

  const acceptAll = () => {
    if (suggestion === null) return null;
    const accepted = suggestion;
    const acceptedNextPrompt = activeAlternative === null && nextPromptGhost !== null;
    clear();
    setSuppressedDraft({ draftKey, draft: accepted });
    if (acceptedNextPrompt) dismissPromptSuggestion();
    return accepted;
  };

  const acceptNextWord = () => {
    if (nextWord === null) return null;
    return draft + nextWord;
  };

  return {
    suggestion,
    remainder,
    nextWord,
    pending,
    alternativeIndex,
    alternativeCount,
    acceptAll,
    acceptNextWord,
    cycle,
    refresh,
    dismiss,
    clear,
  };
}
