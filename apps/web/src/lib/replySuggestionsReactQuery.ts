import type {
  EnvironmentId,
  ModelSelection,
  ReplySuggestionsInput,
  ReplySuggestionsResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

function emptyReplySuggestionsResult(): ReplySuggestionsResult {
  return { suggestions: [] };
}

export const replySuggestionsQueryKeys = {
  all: ["replySuggestions"] as const,
  turn: (
    environmentId: EnvironmentId | null | undefined,
    input: ReplySuggestionsInput | null,
    modelSelection: ModelSelection | null,
  ) =>
    [
      "replySuggestions",
      environmentId ?? null,
      input?.threadId ?? null,
      input?.turnId ?? null,
      input?.promptTemplateId ?? null,
      input?.promptTemplateInstructions ?? null,
      modelSelection?.instanceId ?? null,
      modelSelection?.model ?? null,
      modelSelection?.options ?? null,
    ] as const,
};

export function replySuggestionsQueryOptions(
  environmentId: EnvironmentId | null | undefined,
  input: ReplySuggestionsInput | null,
  modelSelection: ModelSelection | null,
) {
  return queryOptions({
    queryKey: replySuggestionsQueryKeys.turn(environmentId, input, modelSelection),
    queryFn: async () => {
      if (!environmentId || !input) {
        return emptyReplySuggestionsResult();
      }
      const api = ensureEnvironmentApi(environmentId);
      return api.suggestions.generateReplySuggestions(input);
    },
    enabled: environmentId !== null && environmentId !== undefined && input !== null,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
